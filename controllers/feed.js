const { validationResult } = require('express-validator');
const Post = require('../models/post');
const User = require('../models/user');
const fs = require('fs');
const path = require('path');
const ITEMS_PER_PAGE = 2;
const io = require('../socket');

exports.getStatus = async (req, res, next) => {
    const userId = req.userId;

    try {
        const userDoc = await User.findById(userId);
        if(!userDoc){
            const error = new Error('User not found!');
            error.statusCode = 404;
            throw error;
        }
        res.status(200).json({
            message: 'Retrieved User Status',
            status: userDoc.status
        });
        
    } catch (error) {
        if(!error.statusCode){
            error.statusCode = 500;
        }
        next(error);
    }
}

exports.setStatus = async (req, res, next) => {
    const userId = req.userId;
    const newStatus = req.body.status;

    try {
        const userDoc = await User.findById(userId);
        if(!userDoc){
            const error = new Error('User does not exist!');
            error.statusCode = 404;
            throw error;
        }

        userDoc.status = newStatus;
        const saveSuccess = await userDoc.save();
        if(!saveSuccess){
            const error = new Error('Could not save Status!');
            error.statusCode = 500;
            throw error;
        }

        res.status(200).json({
            message: 'Status updated successfully',
            status: newStatus
        })
    } catch (error) {
        if(!error.statusCode){
            error.statusCode = 500;
        }
        next(error);
    }
}

exports.getPosts = async (req, res, next) => {
    const currentPage = req.query.page || 1;
    try {
        const totalItems = await Post.find().countDocuments()
        const posts = await Post.find()
                        .populate('creator')
                        .sort({ createdAt: -1})
                        .skip((currentPage -1) * ITEMS_PER_PAGE)
                        .limit(ITEMS_PER_PAGE)

        if(!posts){
            const error = new Error('Posts not found!')
            error.statusCode = 404;
            //Normally we would do a next() here, but the catch
            // block will catch this error and send it along.
            throw error;
        }
        res.status(200).json({
            message: 'All posts fetched',
            posts: posts,
            totalItems: totalItems
        })
                
    } catch (error) {
        if(!error.statusCode){
            error.statusCode = 500;
        }
        next(error);
    }
};

exports.createPost = async (req, res, next) => {
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        const error = new Error('Validation failed. Data entered is invalid.')
        error.statusCode = 422;
        throw error;
    }
    const title = req.body.title;
    const content = req.body.content;
    const image = req.file;
    if(!image){
        const error = new Error('Error adding image.')
        error.statusCode = 422;
        throw error;
    }

    const post = new Post({
        title: title,
        imageUrl: image.path,
        content: content,
        creator: req.userId
    })

    try {
        const postSaveResult = await post.save();
        if(!postSaveResult){
            const error = new Error('Error saving Post during creation!');
            error.statusCode = 500;
            throw error;
        }
        const user = await User.findById(req.userId);
        if(!user){
            const error = new Error('Cannot add post to non-existent user!');
            error.statusCode = 404;
            throw error;
        }

        user.posts.push(post)
        const userSaveResult = await user.save();
        if(!userSaveResult){
            const error = new Error('Error adding post to User during creation!');
            error.statusCode = 500;
            throw error;
        }

        io.getIO().emit('posts', {
            action: 'create',
            post: {...post._doc, creator: {_id: req.userId, name: user.name}}
        })

        res.status(200).json({
            message: "Created a new post!",
            post: post,
            creator: {
                _id: user._id,
                name: user.name
            }
        })

    } catch (error) {
        if(!error.statusCode){
            error.statusCode = 500;
        }
        next(error);
    }
};

exports.getPost = async (req, res, next) => {
    const postId = req.params.postId;
    try {
        const post = await Post.findById(postId);
        if(!post){
            const error = new Error('Post not found!')
            error.statusCode = 404;
            //Normally we would do a next() here, but the catch
            // block will catch this error and send it along.
            throw error;
        }
        res.status(200).json({
            message: 'Post fetched',
            post: post
        })
    } catch (error) {
        if(!error.statusCode){
            error.statusCode = 500;
        }
        next(error);
    }
}

exports.editPost = async (req, res, next) => {
    const postId = req.params.postId;
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        const error = new Error('Validation failed. Data entered is invalid.')
        error.statusCode = 422;
        throw error;
    }
    const title = req.body.title;
    const content = req.body.content;
    let imageUrl = req.body.image;
    if(req.file){
        imageUrl = req.file.path;
    }
    if(!imageUrl){
        const error = new Error('No file picked')
        error.statusCode = 422;
        throw error;
    }

    try {
        const post = await Post.findById(postId).populate('creator');
        if(!post){
            const error = new Error('Post not found!');
            error.statusCode = 404;
            throw error;
        }
        if(post.creator._id.toString() !== req.userId.toString()){
            const error = new Error('Current user cannot access this post!');
            error.statusCode = 403
            throw error;
        }
        if(imageUrl !== post.imageUrl){
            clearImage(post.imageUrl);
        }

        post.title = title;
        post.imageUrl = imageUrl;
        post.content = content;
        const postSaveResult = await post.save();
        if(!postSaveResult){
            const error = new Error('Error saving edited Post!');
            error.statusCode = 500
            throw error;
        }

        io.getIO().emit('posts', {
            action: 'update',
            post: postSaveResult
        })

        res.status(200).json({
            message: 'Post updated!',
            post: post
        })
        
    } catch (error) {
        if(!error.statusCode){
            error.statusCode = 500;
        }
        next(error);
    }
};

exports.deletePost = async (req, res, next) => {
    const postId = req.params.postId;
    try {
        const post = await Post.findById(postId);
        if(!post){
            const error = new Error('Post not found for user!')
            error.statusCode = 404;
            throw error;
        }
        if(post.creator.toString() !== req.userId.toString()){
            const error = new Error('Current user cannot access this post!');
            error.statusCode = 403
            throw error;
        }

        clearImage(post.imageUrl);
        const postDeletionResult = await Post.findByIdAndDelete(postId);
        if(!postDeletionResult){
            const error = new Error('Error deleting post!');
            error.statusCode = 500
            throw error;
        }

        const user = await User.findById(req.userId);
        if(!user){
            const error = new Error('Error finding User during post deletion!');
            error.statusCode = 404
            throw error;
        }
        user.posts.pull(postId);
        const userSaveResults = await user.save();
        if(!userSaveResults){
            const error = new Error('Error saving User after post deletion!');
            error.statusCode = 500
            throw error;
        }

        io.getIO().emit('posts', {
            action: 'delete',
            post: postId
        })

        res.status(200).json({
            message: 'Post deleted!'
        })
        
    } catch (error) {
        if(!error.statusCode){
            error.statusCode = 500;
        }
        next(error);
    }
}

const clearImage = (filePath) => {
    filePath = path.join(__dirname, '..', filePath);
    fs.unlink(filePath, (err) => {
        if(err){
            throw (err);
        }
    })
}