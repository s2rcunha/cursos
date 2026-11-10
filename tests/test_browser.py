from playwright.sync_api import sync_playwright
from pathlib import Path
import json, mimetypes
site=Path(__file__).resolve().parents[1]/'public'
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
  logs=[]
  page.on('pageerror',lambda error: logs.append(str(error)))
  catalog={'ok':True,'result':{'revision':7,'updatedAt':'2026-11-10T10:00:00Z','courses':[{'id':'curso1','title':'Curso APH Teste','description':'Curso de teste','coverUrl':'','published':True,'modules':[{'id':'mod1','title':'Primeiros socorros','description':'Módulo de teste','pdfUrl':'https://drive.google.com/file/d/x/view','published':True,'videos':[{'id':'vid1','title':'Aula de teste','youtubeId':'1K_9oO79xb4','durationSeconds':180,'order':1}]}]}]}}
  def route_handler(route):
   u=route.request.url
   if '/api/aph' in u:
    route.fulfill(status=200,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(catalog));return
   from urllib.parse import urlparse
   from pathlib import Path
   path=urlparse(u).path.lstrip('/') or 'index.html'
   asset=site/path
   if asset.is_file(): route.fulfill(status=200,body=asset.read_bytes(),content_type=mimetypes.guess_type(str(asset))[0] or 'text/html')
   else: route.fulfill(status=404,body='Not found')
  page.route('https://aph.example.test/**',route_handler)
  html=(site/'index.html').read_text(encoding='utf-8').replace("new URL('/api/aph',window.location.origin).href","'https://aph.example.test/api/aph'").replace("<script src=\"config.js?v=cloudflare-1\"></script>","").replace("const API_URL_OK=/^https?:$/.test(window.location.protocol);","const API_URL_OK=true;")
  page.set_content(html,wait_until='domcontentloaded',timeout=15000)
  page.wait_for_selector('#busy',state='hidden',timeout=12000)
  assert page.locator('#heroCourses').inner_text()=='1 curso', (page.locator('#heroCourses').inner_text(),page.locator('#errorNotice').inner_text(),logs)
  page.locator('#exploreCoursesBtn').click()
  assert page.get_by_role('button',name='Abrir módulos do curso Curso APH Teste').count()==1
  page.get_by_role('button',name='Abrir módulos do curso Curso APH Teste').click()
  assert page.locator('#moduleGrid').get_by_text('Primeiros socorros').count()==1
  page.locator('#moduleGrid').get_by_role('button',name='▶ Ver aulas').click()
  assert page.locator('#lessonGrid').get_by_text('Aula de teste').count()==1
  assert page.locator('#lessonGrid').locator('.video-card').count()==1
  assert not logs,logs
  print('OK: mobile 390px, carregamento API, cursos, módulos, aulas, sem erro JS.')
  browser.close()
finally:
 pass
