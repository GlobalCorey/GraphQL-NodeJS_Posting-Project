const express = require('express');
const path = require('path');
const app = express();
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const MONGODB_URI = `${process.env.MONGODB_URI}`;
const multer = require('multer');
const graphqlHttp = require('express-graphql');
const auth = require('./middleware/auth');
const { clearImage } = require('./utils/file');


const schema = require('./grahpql/schema');
const resolver = require('./grahpql/resolvers');
//NO MORE ROUTES, USING GRAPHQL
// const feedRoutes = require('./routes/feed');
// const authRoutes = require('./routes/auth');

const multerStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'images');
    },
    filename: (req, file, cb) => {
        cb(null, new Date().toISOString() + "-" + file.originalname);
    }
});

const fileFilter = (req, file, cb) => {
    if(file.mimetype === 'image/jpeg' ||
        file.mimetype === 'image/jpg' ||
        file.mimetype === 'image/png'){
            cb(null, true);
        }
    else{
        cb(null, false);
    }
}

app.use(bodyParser.json());
app.use(multer({storage: multerStorage, fileFilter: fileFilter}).single('image'));
app.use('/images', express.static(path.join(__dirname, 'images')));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if(req.method === 'OPTIONS'){
        return res.sendStatus(200);
    }
    next();
});

app.use(auth);

app.put('/post-image', (req, res, next) => {
    if(!req.isAuth){
        throw new Error('Not authenticated.');
    }
    //If no file providing, return, don't clear image
    if(!req.file){
        return res.status(200).json({
            message: 'No file provided.'
        })
    }
    if(req.body.oldPath){
        clearImage(req.body.oldPath);
    }
    return res.status(201).json({
        message: 'File stored.',
        filePath: req.file.path
    })
})

// app.use('/feed', feedRoutes);
// app.use('/auth', authRoutes);


app.use(
    '/graphql', 
    graphqlHttp({
        schema: schema,
        rootValue: resolver,
        graphiql: true,
        customFormatErrorFn(err) {
            if(!err.originalError) {
                return err;
            }
            const data = err.originalError.data;
            const message = err.message || 'An error occurred';
            const code = err.originalError.code || 500;
            return {message: message, status: code, data: data}
        }
}))

app.use((error, req, res, next) => {
    console.log("An Error Occurred: ", error);
    const status = error.statusCode || 500;
    const message = error.message;
    const data = error.data;
    res.status(status).json({
        message: message,
        data: error.data
    })
})

mongoose.connect(MONGODB_URI,{
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => {
    app.listen(8080);
})
.catch(err => console.log(err));