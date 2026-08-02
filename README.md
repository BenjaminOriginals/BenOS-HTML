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
When you install BenOS HTML Edition, make sure to set up your account in the Settings app's Account section. Set up your name, add a password (optional), and add a hint (optional).

#### 1. Clone the repository:

| git clone https://github.com/BenjaminOriginals/BenOS-HTML.git |
| ----- |

#### 2. Run the OS:
Open the BenOS HTML Edition V1 (Beta).html file in any modern web browser.

**Note for persistent storage:** For the IndexedDB file system to save your data permanently, it is highly recommended to serve the file over a local HTTP server (e.g., VS Code Live Server, Python's http.server) rather than opening it directly via the _file://_ protocol.

## Technical Architecture
To make BenOS as portable as possible, the entire OS lives inside a single HTML/JS configuration. The file system relies heavily on async JavaScript, using Promises to manage IndexedDB transactions. For security, apps launch inside their own sandboxed iframes (using allow-scripts and allow-forms). We also built a custom crash bridge listener, so if one app goes down, it won’t crash the whole OS.

## Screenshots
| Lock Screen | Desktop | Desktop w/ Apps |
| ----------- | ------- | --------------- |
| <img width="1440" height="812" alt="Screenshot 2026-08-02 at 12 51 00 PM" src="https://github.com/user-attachments/assets/3b8ceb5f-97c3-41ef-8cc6-b1844566be72" /> | <img width="1440" height="812" alt="Screenshot 2026-08-02 at 12 51 53 PM" src="https://github.com/user-attachments/assets/d9d24397-ceb0-440c-90e8-ee054cadae12" /> | <img width="1440" height="812" alt="Screenshot 2026-08-02 at 12 54 50 PM" src="https://github.com/user-attachments/assets/314b7fdf-2dcc-4181-828e-b0f02ce1cb46" /> |

| User Settings | Files App |
| ------------- | --------- |
| <img width="1440" height="812" alt="Screenshot 2026-08-02 at 12 57 33 PM" src="https://github.com/user-attachments/assets/fc1130d8-7d3a-42a7-b0b3-70edc0757d3a" /> | <img width="1440" height="812" alt="Screenshot 2026-08-02 at 1 03 45 PM" src="https://github.com/user-attachments/assets/9875545b-fff0-4db7-a55a-42212faaff2d" /> |

## Extra info
BenOS HTML Edition does not interact with, modify, or provide the security guarantees of your host operating system (macOS, Windows, Linux, etc.). Because storage relies on browser-based systems like IndexedDB and localStorage, clearing your browser data or cache may result in the permanent loss of virtual files and user configurations. Please back up any important files or data. Original build (Sierra) by @DedeProGames-official.
