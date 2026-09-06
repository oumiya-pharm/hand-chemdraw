import {defineConfig} from '@playwright/test';
const externalURL=process.env.TE_TEST_URL;
export default defineConfig({
  testDir:'tests',testMatch:'offline.spec.ts',
  use:{baseURL:externalURL??'http://127.0.0.1:4173',viewport:{width:1440,height:1000},browserName:'chromium',channel:'chrome'},
  webServer:externalURL?undefined:{command:'npm run preview -- --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:true},
  timeout:60_000
});
