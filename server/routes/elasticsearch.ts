import express from 'express';
import { Request, Response, NextFunction } from 'express';

import { expressSession } from '../middleware/route_middleware_util';
import { asyncHandler } from '../middleware/request_handler_util';
import { esClient } from '../services/request';
import config from '../config/config';
const index = config.database.elasticsearch.cfIndex || 'across-cf-*';

const router = express.Router();
router.use([expressSession()]);

router.post('/search', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { body } = req.body;

        if (!index || !body) {
            console.warn('Missing required fields:', { index: !!index, body: !!body });
            return res.status(400).json({
                error: 'Missing required fields: index, body'
            });
        }

        console.log('🔍 Elasticsearch Query:', {
            index,
            query: body.query,
            aggs: body.aggs ? Object.keys(body.aggs) : [],
            size: body.size
        });

        // ✅ 执行 Elasticsearch 查询
        console.log({
            index,
            body
        })
        const response = await esClient.search({
            index,
            body
        });

        console.log('✅ Elasticsearch Response:', {
            took: response.took,
            hits: response.hits?.total,
            aggs: response.aggregations ? Object.keys(response.aggregations) : []
        });

        // ✅ 返回结果
        return res.json(response);

    } catch (error: any) {
        console.error('❌ Elasticsearch search error:', error);
        return res.status(500).json({
            error: error.message || 'Elasticsearch search failed'
        });
    }
}));

export default router;
