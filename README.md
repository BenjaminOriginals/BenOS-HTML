# BenOS-HTML
The HTML edition of BenOS! Performs very well and operates fully on HTML and can be run in any browser that supports it. Has multiple useful apps, built for everyday productivity. Here is a list of a few:
| App | Function |
|-----|----------|
| BenBrowser | A fast, secure, and private browser built for your workflow, seamlessly integrated into the BenOS ecosystem. |
| BenStudio | Native HTML, CSS, and JavaScript editor - make your own apps to install right in BenOS HTML Edition! With BenStudio, as long as you can code, you can have any app at all! |
| BenMusic | Ad-free, offline music - no subscription required! The library of available music is always expanding, and you can request new music to be added by contacting us (see bottom). |
| Files | Your secure personal and workspace file viewer. The Files app gives ultimate transparency, truly showing you what is taking up storage on your BenOS device. |
| Terminal | Interact with the system and execute commands through a text-based interface. |
| BenPen | Make simple art and handwritten notes natively in BenOS HTML Edition. Save, open, edit, and export projects any time! |
| BenViewer | View images and videos natively in BenOS HTML Edition. |

## Installation & Usage
When you install BenOS HTML Edition, make sure to set up your account in the Account section of the Settings app. Set up your name, add a password (optional), and add a hint (optional).

Clone the repository:

Bash
git clone https://github.com/BenjaminOriginals/BenOS-HTML.git
Run the OS:
Simply open the BenOS HTML Edition V1 (Beta).html file in any modern web browser.

Note for persistent storage: For the IndexedDB file system to save your data permanently, it is highly recommended to serve the file over a local HTTP server (e.g., VS Code Live Server, Python's http.server) rather than opening it directly via the file:// protocol.

## Technical Architecture
To make BenOS as portable as possible, the entire OS lives inside a single HTML/JS configuration. The file system relies heavily on async JavaScript, using Promises to manage IndexedDB transactions. For security, apps launch inside their own sandboxed iframes (using allow-scripts and allow-forms). We also built a custom crash bridge listener, so if one app goes down, it won’t crash the whole OS.

Original build (Sierra) by DedeProGames.
