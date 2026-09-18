const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const routes = {'/':'tests/production-preview.html','/production-dashboard.js':'production-dashboard.js','/production-dashboard.css':'production-dashboard.css'};
http.createServer((request,response)=>{
  const file=routes[new URL(request.url,'http://localhost').pathname];
  if(!file){response.writeHead(404);response.end();return;}
  response.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html');
  response.end(fs.readFileSync(path.join(__dirname,'..',file)));
}).listen(4178,'127.0.0.1',()=>console.log('Local visual-test fixture: http://127.0.0.1:4178 (no live database)'));
