const User = require('../models/user');
const Post = require('../models/post');
const bcrypt = require('bcrypt');
const BCRYPT_SALT = 12;
const validator = require('validator');
const jwt = require('jsonwebtoken');
const { clearImage } = require('../utils/file');

module.exports = {
    createUser: async function({userInput}, req){
        const errors =[];
        if(!validator.isEmail(userInput.email)){
            errors.push({message: 'Email is invalid'});
        }
        if(validator.isEmpty(userInput.password) || 
            !validator.isLength(userInput.password, { min: 5})){
            errors.push({message: 'Password too short!'});
        }

        if(errors.length > 0){
            const error = new Error('Invalid input.');
            error.data = errors;
            error.code = 422;
            throw error
        }
        const existingUser = await User.findOne({email: userInput.email})
        if(existingUser){
            const error = new Error('User already exists');
            throw error;
        }

        const hashedPassword = await bcrypt.hash(userInput.password, BCRYPT_SALT)
        const user = new User({
            email: userInput.email,
            name: userInput.name,
            password: hashedPassword
        });

        const createdUser = await user.save();
        return {...createdUser._doc, _id: createdUser._id.toString()};
    },

    login: async function( {email, password}, req){ 
        const user = await User.findOne({email: email})
        if(!user){
            const error = new Error('Email or password is incorrect.');
            error.code = 401;
            throw error;
        }
        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if(!isPasswordCorrect){
            const error = new Error('Email or password is incorrect.');
            error.code = 401;
            throw error;
        }

        const token = jwt.sign({
            email: user.email,
            userId: user._id.toString()
        },
        `${process.env.SECRET_TOKEN}`,
        {expiresIn: '1h'});

        return {token: token, userId: user._id.toString()}
    },

    createPost: async function({ postInput }, req){
        //Validate input errors
        if(!req.isAuth){
            const error = new Error('Not authenticated!');
            error.code = 401;
            throw error;
        }
        const errors =[];
        if(!validator.isLength(postInput.title, {min: 5})){
            errors.push({message: 'Title needs to be longer.'});
        }
        if(!validator.isLength(postInput.content, {min: 5})){
            errors.push({message: 'Content needs to be longer.'});
        }
        if(errors.length > 0){
            const error = new Error('Invalid input.');
            error.data = errors;
            error.code = 422;
            throw error
        }
        //Save Post data to consts
        const title = postInput.title;
        const image = postInput.imageUrl;
        const content = postInput.content;
        //Image checking
        
        //Get user info
        const user = await User.findById(req.userId);
        if(!user){
            const error = new Error('Invalid User.');
            error.code = 401;
            throw error
        }
        //Create new post Obj, save it
        const newPost = new Post({
            title: title,
            imageUrl: image,
            content: content,
            creator: user
        });
        const newPostSaveResult = await newPost.save();
        //Push new post to User's posts array
        user.posts.push(newPost);
        const userSaveResult = await user.save();
        //Send response

        return {
            ...newPostSaveResult._doc, 
            _id: newPostSaveResult._id.toString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    },

    updatePost: async function({ postId, postInput}, req){
        if(!req.isAuth){
            const error = new Error('Not Authenticated!')
            error.code = 401;
            throw error
        }
        const errors =[];
        if(!validator.isLength(postInput.title, {min: 5})){
            errors.push({message: 'Title needs to be longer.'});
        }
        if(!validator.isLength(postInput.content, {min: 5})){
            errors.push({message: 'Content needs to be longer.'});
        }
        if(errors.length > 0){
            const error = new Error('Invalid input.');
            error.data = errors;
            error.code = 422;
            throw error
        }

        const post = await Post.findById(postId).populate('creator');
        if(!post){
            const error = new Error('Could not find post!');
            error.code = 404;
            throw error
        }

        if(post.creator._id.toString() !== req.userId.toString()){
            const error = new Error('Cannot edit post of another user!')
            error.code = 403;
            throw error
        }

        post.title = postInput.title;
        post.content = postInput.content;
        if(postInput.imageUrl !== 'undefined'){
            post.imageUrl = postInput.imageUrl;
        }
        const postSaveResult = await post.save();

        return {
            ...postSaveResult._doc,
            _id: postSaveResult._id.toString(),
            createdAt: postSaveResult.createdAt.toISOString(),
            updatedAt: new Date().toISOString()
        };
    },

    deletePost: async function({ postId }, req){
        if(!req.isAuth){
            const error = new Error('Not Authenticated!')
            error.code = 401;
            throw error
        }

        const post = await Post.findById(postId);
        if(!post){
            const error = new Error('Could not find Post to delete.');
            error.code = 404;
            throw error;
        }

        if(post.creator.toString() !== req.userId.toString()){
            const error = new Error('Cannot delete post of another user!')
            error.code = 403;
            throw error
        }

        const deletePostResult = await Post.deleteOne({_id: postId});
        if(!deletePostResult){
            const error = new Error('Could not find and remove Post.')
            error.code = 500;
            throw error
        }

        clearImage(post.imageUrl);
        const user = await User.findById(req.userId)
        user.posts.pull(postId);
        const userSaveResult = await user.save();
        if(!userSaveResult){
            const error = new Error('Could not find and remove Post.')
            error.code = 500;
            throw error
        }

        const deletionSuccess = (deletePostResult.deletedCount === 1);
        return deletionSuccess;
    },

    posts: async function({ page },req){
        //Check authentication
        //If authenticated, get all posts from Post
        const perPage = 2;
        if(!req.isAuth){
            const error = new Error('Not Authenticated!')
            error.code = 401;
            throw error
        }
        if(!page){
            page = 1;
        }

        const totalPosts = await Post.find().countDocuments();

        const posts = await Post.find()
                            .populate('creator')
                            .sort({ createdAt: -1})
                            .skip((page -1) * perPage)
                            .limit(perPage)
                            
        if(!posts){
            const error = new Error('Could not find Posts.');
            error.code = 404;
            throw error;
        }
        const returnPosts = posts.map(p => {
            return {
                ...p._doc,
                _id: p._id.toString(),
                createdAt: p.createdAt.toISOString(),
                updatedAt: p.updatedAt.toISOString()
            }
        })

        return {posts: returnPosts, totalPosts: totalPosts}
    },

    post: async function({ postId }, req){
        //Check if auth
        if(!req.isAuth){
            const error = new Error('Not authenticated!');
            error.code = 401;
            throw error; 
        }

        //Search for post in Post collection, populate 'creator'
        const post = await Post.findById(postId)
                                .populate('creator');
        if(!post){
            const error = new Error('Could not find post!');
            error.code = 404;
            throw error
        }
        
        //  Return post data 
        //      title, author, imageUrl, content, createdAt
        return {
            ...post._doc,
            _id: post._id.toString(),
            createdAt: post.createdAt.toISOString()
        }
    },

    status: async function(args, req){
        if(!req.isAuth){
            const error = new Error('Not authorized.');
            error.code = 401;
            throw error;
        }

        const user = await User.findById(req.userId);
        if(!user){
            const error = new Error('User not found!');
            error.code = 404;
            throw error;
        }

        return {
            ...user._doc,
            _id: user._id.toString()
        }
    },
    setStatus: async function({ status }, req){
        if(!req.isAuth){
            const error = new Error('Not authorized.');
            error.code = 401;
            throw error;
        }

        const user = await User.findById(req.userId);
        if(!user){
            const error = new Error('User not found!');
            error.code = 404;
            throw error;
        }
        user.status = status;
        const userSaveResult = await user.save();
        if(!userSaveResult){
            const error = new Error('Error during user status save.');
            error.code = 500;
            throw error;
        }

        return {
            ...userSaveResult._doc, 
            _id: userSaveResult._id.toString()
        }
    }
};