import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const isProd = mode === 'production' || mode === 'prod';
    const rootDomain = env.ROOT_DOMAIN?.trim().toLowerCase().replace(/\.$/, '');
    if (isProd && !rootDomain)
        throw new Error('ROOT_DOMAIN must be defined for a production docs build');
    const resolvedRootDomain = rootDomain || 'qysyw.cn';
    return {
        define: {
            'import.meta.env.VITE_APP_BASE_URL': JSON.stringify(env.VITE_APP_BASE_URL?.trim() || `https://www.${resolvedRootDomain}`),
        },
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
                            target: `https://api.${resolvedRootDomain}`,
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
