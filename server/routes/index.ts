import express from 'express';
// import formidable from 'formidable';
import { asyncHandler } from '../middleware/request_handler_util';
var router = express.Router();

/* GET home page. */
router.get('/', function (req, res, next) {
    res.render('index', { title: 'Express' });
});

router.get('/are_you_alive', function(req, res, next) {
    res.json({ alive: true });
});

export default router;
