'use strict';
const permissionApi = globalThis.browser || chrome;
const permissionScope = new URLSearchParams(location.search).get('scope');
const validScope = permissionScope && FdPdf.permissionScope(permissionScope) === permissionScope;
document.getElementById('host').textContent = validScope ? new URL(permissionScope).hostname : '无效的服务器地址';
document.getElementById('allow').disabled = !validScope;
document.getElementById('allow').addEventListener('click', () => {
  permissionApi.permissions.request({ origins: [permissionScope] }).then((granted) => {
    if (granted) window.close();
    else document.getElementById('message').textContent = '尚未授权，可以稍后从“更多功能”再次打开。';
  }).catch((error) => { document.getElementById('message').textContent = error.message; });
});
document.getElementById('cancel').addEventListener('click', () => window.close());
