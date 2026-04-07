import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const repository = process.env.GITHUB_REPOSITORY ?? '';
const repositoryName = repository.split('/')[1] ?? '';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : '/',
  define: {
    __VIRTUALIZE__: process.env.VIRTUALIZE === 'false' ? 'false' : 'true',
  },
});
