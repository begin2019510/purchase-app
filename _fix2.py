with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# The thumbHtml ternary ends with :'')  but should end with :'');
# Find and fix the specific line
search = "showFullscreenImg(this.src)\">`:''"
replace = "showFullscreenImg(this.src)\">`:''"

# Actually the issue is the closing of the const statement
# It should be: const thumbHtml = ... :'');
# Currently it's: const thumbHtml = ... :''
# We need to add ); after the last ''

# Let me find the exact pattern
import re
# Match the thumbHtml line that ends without );
pattern = r"(const thumbHtml=isKv\?.*?:'')\n"
match = re.search(pattern, content)
if match:
    old = match.group(0)
    new = match.group(1) + ');\n'
    content = content.replace(old, new)
    print('Fixed with regex')
else:
    print('Regex pattern not found')
    # Try simpler approach - just find the line
    idx = content.find("showFullscreenImg(this.src)\">`:''")
    if idx >= 0:
        # Check what's after
        after = content[idx+len("showFullscreenImg(this.src)\">`:''"):idx+len("showFullscreenImg(this.src)\">`:''")+5]
        print(f'After: {repr(after)}')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)
