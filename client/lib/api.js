/**
 * Centralized API base URL configuration.
 *
 * SINGLE SOURCE OF TRUTH — every frontend module that calls the Express backend
 * should import API_BASE from here instead of re-declaring it.
 *
 * In production (Vercel), NEXT_PUBLIC_EXPRESS_API_URL is set via the Vercel
 * dashboard → Project Settings → Environment Variables → Production.
 *
 * In local development, the fallback is http://localhost:5000.
 */
const API_BASE =
  process.env.NEXT_PUBLIC_EXPRESS_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:5000';

export default API_BASE;
