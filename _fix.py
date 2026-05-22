import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Card thumbnail - need async fetch for kv: images
old1 = "const imgSrc=e['图片']&&e['图片'].startsWith('kv:')?'/api/images?key='+encodeURIComponent(e['图片'].slice(3)):e['图片'];"
new1 = "const rawImg=e['图片']||'';const isKv=rawImg.startsWith('kv:');"

if old1 in content:
    content = content.replace(old1, new1)
    print('Fixed pattern 1')
else:
    print('Pattern 1 NOT FOUND')
    # Show context
    idx = content.find("startsWith('kv:')")
    if idx >= 0:
        print(repr(content[max(0,idx-100):idx+200]))

# Fix 2: The thumbHtml line uses imgSrc which no longer exists
old2 = "const thumbHtml=imgSrc?`<img class=\"ex-thumb\" src=\"${imgSrc}\" onclick=\"event.stopPropagation();showFullscreenImg(this.src)\">`:'';"
new2 = "const thumbHtml=isKv?`<img class=\"ex-thumb\" data-kv=\"${rawImg.slice(3)}\" onclick=\"event.stopPropagation();loadKvImg(this)\">`:(rawImg?`<img class=\"ex-thumb\" src=\"${rawImg}\" onclick=\"event.stopPropagation();showFullscreenImg(this.src)\">`:''"

if old2 in content:
    content = content.replace(old2, new2)
    print('Fixed pattern 2')
else:
    print('Pattern 2 NOT FOUND')
    idx = content.find("thumbHtml=imgSrc")
    if idx >= 0:
        print(repr(content[idx:idx+200]))

# Fix 3: Add loadKvImg function before showFullscreenImg
old3 = "function showFullscreenImg(src){"
new3 = """async function loadKvImg(el){try{const r=await fetch('/api/images?key='+encodeURIComponent(el.dataset.kv),{headers:{'X-API-Key':getPin()}});const url=await r.text();el.src=url;el.onclick=function(e){e.stopPropagation();showFullscreenImg(url)}}catch(e){el.style.display='none'}}
function showFullscreenImg(src){"""

if old3 in content:
    content = content.replace(old3, new3)
    print('Fixed pattern 3')
else:
    print('Pattern 3 NOT FOUND')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
