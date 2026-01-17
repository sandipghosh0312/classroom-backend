import { Request, Response, NextFunction } from "express";
import aj from "../config/arcjet";
import { ArcjetNodeRequest, slidingWindow } from "@arcjet/node";

const securityMiddleware = async (request: Request, response: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'test') {
        return next();
    }

    try {
        const role: RateLimitRole = request.user?.role ?? 'guest';
        let limit: number;
        let message: string;

        switch (role) {
            case 'admin':
                limit = 20;
                message = 'Admin request limit exceeded (20 per minute)';
                break;
            case 'teacher':
            case 'student':
                limit = 10;
                message = 'User request limit exceeded (10 per minute)';
                break;
            default:
                limit = 5;
                message = 'Guest request limit exceeded (5 per minute). Sign up for higher limits';
        }

        const cleint = aj.withRule(
            slidingWindow({
                mode: "LIVE",
                interval: '1m', // 1 minute
                max: limit,
            })
        )

        const arcjetRequest: ArcjetNodeRequest = {
            headers: request.headers,
            method: request.method,
            url: request.originalUrl ?? request.url,
            socket: {
                remoteAddress: request.socket.remoteAddress ?? request.ip ?? '0.0.0.0'
            },
        }

        const decision = await cleint.protect(arcjetRequest);

        if (decision.isDenied() && decision.reason.isShield()) {
            return response.status(403).json({ error: 'Forbidden', message: 'Access denied: Bot traffic is not allowed' });
        }
        if (decision.isDenied() && decision.reason.isBot()) {
            return response.status(403).json({ error: 'Forbidden', message: 'Access denied: Request blocked by security policy' });
        }
        if (decision.isDenied() && decision.reason.isRateLimit()) {
            return response.status(403).json({ error: 'Too many request', message });
        }

        next();
    } catch (error) {
        console.error('Arcjet middleware error:', error);
        response.status(500).json({ error: 'Internal Server Error', message: 'Something went wrong with the security middleware' });
    }
}

export default securityMiddleware;