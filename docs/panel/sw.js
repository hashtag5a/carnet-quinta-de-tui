/* Servicio mínimo: permite instalar el panel como app. No guarda nada en caché. */
self.addEventListener('install',function(){self.skipWaiting()});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});
self.addEventListener('fetch',function(e){
  if(e.request.mode==='navigate'&&e.request.method==='GET'){
    e.respondWith(fetch(e.request.url,{cache:'no-cache',credentials:'same-origin'}).catch(function(){
      return fetch(e.request).catch(function(){return new Response('Sin conexión. Vuelve a intentarlo cuando tengas internet.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})})}))
  }
});
