// /api/claude.js — Vercel Serverless Function
// Sert de proxy entre la web app Alberto et l'API Claude d'Anthropic.
// La clé API reste côté serveur (variable d'environnement), jamais exposée.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-alberto-secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const requiredSecret = process.env.ALBERTO_SECRET;
  if (requiredSecret) {
    const providedSecret = req.headers['x-alberto-secret'];
    if (providedSecret !== requiredSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.
