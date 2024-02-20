import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import Path from 'path';

export default defineConfig(({ command }) => {
    return {
        server: {
            host: '127.0.0.1',
            port: 3000,
            hmr: true,
        },
        appType: 'custom',
        publicDir: false,
        build: {
            outDir: Path.resolve('dist'),
            target: [],
            ssr: true,
            rollupOptions: {
                input: Path.resolve('_worker.ts'),
            },
            minify: command === 'build',
            manifest: false,
            ssrManifest: false,
            copyPublicDir: false,
        },
        esbuild: {
            drop: command === 'build' ?
                ['console', 'debugger'] :
                undefined,
        },
        plugins: [
            tsconfigPaths(),
        ],
    };
});
