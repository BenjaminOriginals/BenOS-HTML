# BenOS-HTML
BenOS HTML is a high-performance, browser-based OS for productivity and creation running in any modern browser on a very light installation file (zip downloadable here). Built on HTML and JavaScript, BenOS HTML offers an intuitive file manager, exclusive music on BenMusic, an HTML editor with live preview in the BenStudio app, and amazing customization in Settings. Here is a list of the apps pre-installed on BenOS HTML:
| App | Function |
|-----|----------|
| BenBrowser | A fast, secure, and private browser built for your workflow, seamlessly integrated into the BenOS ecosystem. |
| BenStudio | Native HTML, CSS, and JavaScript editor - make your own apps to install right in BenOS HTML! With BenStudio, as long as you can program in HTML, you can build any app you want! |
| BenMusic | Ad-free, offline music - no subscription required! The library of available music is always expanding, and you can request new music to be added by contacting us (see Contact section). |
| Files | Your secure personal and workspace file viewer. The Files app gives ultimate transparency, truly showing you what is taking up storage on your BenOS device. |
| Terminal | Interact with the system and execute commands through a text-based interface. |
| BenPen | Make simple art and handwritten notes natively in BenOS HTML. Save, open, edit, and export projects any time! |
| BenViewer | View images and videos natively in BenOS HTML. |

## Installation & Usage
When you install BenOS HTML, make sure to set up your account in the Settings app's Account section. Set up your name, add a password (optional), and add a hint (optional).

#### 1. Download files:
Click on the green 'Code' button at the top of the repository, and click 'Download ZIP'

#### 2. Set up BenOS HTML
Extract the files from the ZIP, then open the folder and double-click on the HTML file (may look like: **BenOS HTML _version_.html**)

#### 3. Run the OS:
When the HTML file is opened in your browser, open settings and set up your user account. Then, you're all set to have fun using BenOS HTML!

*Note for persistent storage:* For the IndexedDB file system to save your data permanently, it is highly recommended to serve the file over a local HTTP server (e.g., VS Code Live Server, Python's http.server) rather than opening it directly via the _file://_ protocol.

## Technical Architecture
To make BenOS as lightweight as possible, the entire OS lives inside a single HTML/JS configuration. The file system relies heavily on async JavaScript, using Promises to manage IndexedDB transactions. For security, apps launch inside their own sandboxed iframes (using allow-scripts and allow-forms). We also built a custom crash bridge listener, so if one app goes down, it won’t crash the whole OS.

## Screenshots
| Lock Screen | Desktop | Desktop w/ Apps |
| ----------- | ------- | --------------- |
| <img width="1440" height="812" alt="Screenshot 2026-08-23 at 11 53 47 AM" src="https://github.com/user-attachments/assets/d7b9fdd3-0bab-4f94-ad6d-136ad4539d8b" /> | <img width="1440" height="812" alt="Screenshot 2026-08-23 at 11 54 05 AM" src="https://github.com/user-attachments/assets/0a827869-6ab6-4b17-b2dc-50e1e8813ddd" /> | <img width="1440" height="812" alt="Screenshot 2026-08-23 at 11 55 52 AM" src="https://github.com/user-attachments/assets/3c09c3f8-556f-4c0b-bfe9-5f4be6216679" /> |

| BenMusic | User Settings | Files App |
| -------- | ------------- | --------- |
| <img width="1440" height="812" alt="Screenshot 2026-08-02 at 1 39 07 PM" src="https://github.com/user-attachments/assets/f55130ab-75e3-4505-b78c-8cb02d29e2ed" /> | <img width="1440" height="812" alt="Screenshot 2026-08-02 at 12 57 33 PM" src="https://github.com/user-attachments/assets/fc1130d8-7d3a-42a7-b0b3-70edc0757d3a" /> | <img width="1440" height="812" alt="Screenshot 2026-08-02 at 1 03 45 PM" src="https://github.com/user-attachments/assets/9875545b-fff0-4db7-a55a-42212faaff2d" /> |

| BenViewer | BenStudio |
| --------- | --------- |
| <img width="1440" height="814" alt="Screenshot 2026-08-03 at 11 54 24 AM" src="https://github.com/user-attachments/assets/fed47111-5444-4c2b-aba7-261d90894587" /> | <img width="1440" height="814" alt="Screenshot 2026-08-03 at 11 56 36 AM" src="https://github.com/user-attachments/assets/a8abbd28-3c2e-4638-8001-4aebf0159436" /> |

## Extra info
BenOS HTML does not interact with, modify, or provide the security guarantees of your host operating system (macOS, Windows, Linux, etc.). Because storage relies on browser-based systems like IndexedDB and localStorage, clearing your browser data or cache may result in the permanent loss of virtual files and user configurations. Please back up any important files or data. Original build (Sierra) by @DedeProGames-official.
