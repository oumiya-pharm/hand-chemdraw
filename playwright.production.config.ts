import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:'offline.spec.ts',use:{baseURL:'http://127.0.0.1:4173',viewport:{width:1440,height:1000},browserName:'chromium',channel:'chrome'},webServer:{command:'npm run preview -- --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:true},timeout:60_000});
