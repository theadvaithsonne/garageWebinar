import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
  timeout: 10000,
});

// Attach Bearer token from localStorage on every request
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Handle 401 — clear auth and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);

export default api;
