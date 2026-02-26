/**
 * 🛠️ Token Utilities
 * 
 * Centralized token parsing for both:
 * - Plain UUID (guest tokens)
 * - JWT tokens (registered users)
 */

export function getUserIdFromToken(authHeader?: string): string {
    if (!authHeader) return '';
    
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const trimmed = token.trim();
    
    // If it's plain UUID (guest token), return as-is
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(trimmed)) {
        return trimmed;
    }
    
    // Otherwise decode as JWT
    try {
        const base64Payload = trimmed.split('.')[1];
        if (!base64Payload) return '';
        const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
        return payload.sub || '';
    } catch {
        return '';
    }
}

export function isJwtToken(token: string): boolean {
    return token.split('.').length === 3;
}
