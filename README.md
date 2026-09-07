# BenOS-HTML
BenOS HTML is a high-performance, browser-based OS for productivity and creation running in any modern browser on a very light installation file (zip downloadable here). Built on HTML and JavaScript, BenOS HTML offers an intuitive file manager, exclusive music on BenMusic, an HTML editor with live preview in the BenStudio app, and amazing customization in Settings. Here is a list of the apps pre-installed on BenOS HTML:
| App | Function |
|-----|----------|
| BenStudio | Native HTML, CSS, and JavaScript editor - make your own apps to install right in BenOS HTML! With BenStudio, as long as you can program in HTML, you can build any app you want! |
| BenMusic | Ad-free, offline music - no subscription required! The library of available music is always expanding, and you can request new music to be added by contacting us (see Contact section). |
| Files | Your secure personal and workspace file viewer. The Files app gives ultimate transparency, truly showing you what is taking up storage on your BenOS device. |
| Terminal | Interact with the system and execute commands through a text-based interface. |
| BenPen | Make simple art and handwritten notes natively in BenOS HTML. Save, open, edit, and export projects any time! |
| BenViewer | View images and videos natively in BenOS HTML. |
| BenBrowser | A fast, secure, and private browser built for your workflow, seamlessly integrated into the BenOS ecosystem. |

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
| <img width="1440" height="812" alt="Screenshot 2026-09-06 at 7 30 59 PM" src="https://github.com/user-attachments/assets/10670011-f36e-46ff-ab86-d0af69676923" /> | <img width="1440" height="812" alt="Screenshot 2026-09-06 at 7 30 36 PM" src="https://github.com/user-attachments/assets/6656ac1c-5ae3-4464-aa80-d7b4bb20e473" /> | <img width="1440" height="812" alt="Screenshot 2026-09-06 at 7 32 45 PM" src="https://github.com/user-attachments/assets/7d6b2851-14ae-4e96-85db-a3dc04bc6803" /> |

| BenMusic | Files App |
| -------- | --------- |
| <img width="1440" height="812" alt="Screenshot 2026-09-07 at 12 26 39 PM" src="https://github.com/user-attachments/assets/1a961e34-76d6-479f-be14-848024f4417f" /> | <img width="1440" height="812" alt="Screenshot 2026-09-07 at 12 28 46 PM" src="https://github.com/user-attachments/assets/13bb8849-90eb-4683-8804-df98023ee025" /> |

| BenViewer | BenStudio |
| --------- | --------- |
| <img width="1440" height="812" alt="Screenshot 2026-09-07 at 12 31 34 PM" src="https://github.com/user-attachments/assets/6f30382d-e48e-45ea-9aa2-c69189f937b7" /> | <img width="1440" height="812" alt="Screenshot 2026-09-07 at 12 35 38 PM" src="https://github.com/user-attachments/assets/f2dc7010-bfbc-47f6-b0b5-8e9668b1aa4d" /> |

## Extra info
BenOS HTML does not interact with, modify, or provide the security guarantees of your host operating system (macOS, Windows, Linux, etc.). Because storage relies on browser-based systems like IndexedDB and localStorage, clearing your browser data or cache may result in the permanent loss of virtual files and user configurations. Please back up any important files or data. Original build (Sierra) by @DedeProGames-official.
