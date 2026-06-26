import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
	plugins: [react()],
	clearScreen: false,
	server: {
		port: 5180,
		strictPort: true,
		host: host || 'localhost',
		hmr: host
			? {
					protocol: 'ws',
					host,
					port: 5181
				}
			: undefined,
		watch: {
			ignored: ['**/src-tauri/**']
		}
	},
	envPrefix: ['VITE_', 'TAURI_'],
	build: {
		target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
		minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
		sourcemap: !!process.env.TAURI_DEBUG,
		rollupOptions: {
			input: {
				main: path.resolve(__dirname, 'index.html'),
				'tileset-editor': path.resolve(__dirname, 'tileset-editor.html')
			}
		}
	},
	resolve: {
		alias: {
			'~': path.resolve(__dirname, './src')
		}
	}
}));
