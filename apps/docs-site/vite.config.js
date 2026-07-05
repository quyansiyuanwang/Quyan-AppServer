import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => {
    const isProd = mode === 'production' || mode === 'prod';
    return {
        plugins: [
            vue(),
            {
                name: 'generate-404',
                closeBundle() {
                    copyFileSync(resolve(__dirname, 'dist/index.html'), resolve(__dirname, 'dist/404.html'));
                },
            },
        ],
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url)),
            },
        },
        server: {
            host: '0.0.0.0',
            port: 4173,
            proxy: {
                ...(isProd
                    ? {
                        '/prod-api': {
                            target: 'https://api.qysyw.cn',
                            changeOrigin: true,
                            secure: true,
                            rewrite: (path) => path.replace(/^\/prod-api/, ''),
                        },
                    }
                    : {}),
            },
        },
    };
});
