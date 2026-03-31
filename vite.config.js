import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repository = process.env.GITHUB_REPOSITORY ?? '';
const repositoryName = repository.split('/')[1] ?? '';

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : '/',
  define: {
    __VIRTUALIZE__: process.env.VIRTUALIZE === 'false' ? 'false' : 'true',
  },
});
