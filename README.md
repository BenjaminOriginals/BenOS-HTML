# ![logo](https://lh3.googleusercontent.com/pw/AP1GczOAmg904sOHG3i5Y9jW8Q9ZX856tuUtnaayBxIvaM-hYd5NLaqUc_yy84NyF7wHtS9ZRRFjxYQKzW-atFrEwqw1Mn_lHq7CQeOYGEoEFrDJZCn8p1U5KFCPXSgJ5D9IPeB4359AbRkUUpxDOp24J0NQ=w500-h125-p)
BenOS HTML is a high-performance, browser-based OS for productivity and creation running in any modern browser on a very light installation file (zip downloadable here). Built on HTML and JavaScript, BenOS HTML offers an intuitive file manager, exclusive music on BenMusic, an HTML editor with live preview in the BenStudio app, and amazing customization in Settings. Here is a list of the apps pre-installed on BenOS HTML:
| App | Function |
|-----|----------|
| BenAI | The on-device AI assistant (with Open Chat download available) that helps you with everyday tasks and knowhow |
| BenStudio | Native HTML, CSS, and JavaScript editor - make your own apps to install right in BenOS HTML! With BenStudio, as long as you can program in HTML, you can build any app you want! |
| BenMusic | Ad-free, offline music - no subscription required! The library of available music is always expanding, and you can request new music to be added by contacting us (see Contact section). |
| Files | Your secure personal and workspace file viewer. The Files app gives ultimate transparency, truly showing you what is taking up storage on your BenOS device. |
| Terminal | Interact with the system and execute commands through a text-based interface. |
| BenPen | Make simple art and handwritten notes natively in BenOS HTML. Save, open, edit, and export projects any time! |
| BenHealth | Health meets the big screen. With everything you need on the biggest portable (or non portable) screen you have, interact with an advanced, research-driven health app. No payments, ever. |
| BenCam | Snap a picture or video in the app, or use it to make your profile picture. Includes night mode and Pro Tools. |
| BenViewer | View images and videos natively in BenOS HTML. |
| BenBrowser | A fast, secure, and private browser built for your workflow, seamlessly integrated into the BenOS ecosystem. |

## Using BenOS HTML on the web (installation below if you prefer on device)
To use BenOS HTML on the web, visit [mybenos.benjaminoriginals.com](https://mybenos.benjaminoriginals.com)
Is is better or worse? No, it is just the same. All of your data is saved and is kept even when updates are pushed to the web version. As long as you don't mess with your browser's cache/storage settings, it should be fine. If you do plan on tweaking browser cache/storage settings, you may want to back up important data just in case.

## Installation & On-device Usage
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
| Sign in Screen | Desktop | 
| -------------- | ------- |
| <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 03 11 PM" src="https://github.com/user-attachments/assets/eb385fe0-e739-4d71-bb13-89806590ef08" /> | <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 01 44 PM" src="https://github.com/user-attachments/assets/e6b43c89-36aa-4359-a56f-a560ffa81bae" /> |

| Lock Screen | Desktop (Dark Mode) |
| ----------- | ------------------- |
| <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 03 32 PM" src="https://github.com/user-attachments/assets/4e15a407-cd33-4fe9-b239-fda98e0741ea" /> | <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 04 00 PM" src="https://github.com/user-attachments/assets/f718f7f4-632e-41bb-acc9-3320f35f4848" /> |

| BenMusic | BenAI |
| -------- | ----- |
| <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 04 33 PM" src="https://github.com/user-attachments/assets/9108d968-6eb8-498f-a917-6d694fdf0684" /> | <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 05 28 PM" src="https://github.com/user-attachments/assets/f01b889c-683e-4134-8b44-74895c1536fb" /> |

| BenWeather | BenBrowser |
| ---------- | ---------- |
| <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 10 06 PM" src="https://github.com/user-attachments/assets/9a153301-0f2c-45c5-bba9-96ae4c13849f" /> | <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 10 42 PM" src="https://github.com/user-attachments/assets/6a238dc5-e83b-4e1e-a686-b020d5cdb402" /> |

| BenHealth | Settings |
| --------- | -------- |
| <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 11 16 PM" src="https://github.com/user-attachments/assets/ec122168-e731-4b3d-ba48-57561f3472ab" /> | <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 11 39 PM" src="https://github.com/user-attachments/assets/0391382f-4fca-4cdb-9bb8-fdbb31980551" /> |

| BenViewer | BenStudio |
| --------- | --------- |
| <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 06 52 PM" src="https://github.com/user-attachments/assets/d05f8752-3fb4-4c18-9ccd-d776cf3cf0d4" /> | <img width="1440" height="812" alt="Screenshot 2026-10-20 at 10 07 19 PM" src="https://github.com/user-attachments/assets/f993e048-3169-408f-9b04-21a90918f9e6" /> |

## For Businesses
In BenOS HTML, you can enable Demo Mode to show off devices with an ultra-high-performance, lightweight OS. You can present it on any device, to anyone! The best part is, BenOS HTML has BenOS Connect fused into the software, so no matter what users try to do, they cannot mess with your own BenOS HTML stuff, only the stuff that needs to be shown off. All you have to do is create an account to host the demo and follow these steps:
### Activating Demo Mode
Under Settings > Users, you can turn on the Demo Mode toggle, which will instantly activate the demo. Anyone who comes up to the device will be restricted to only the demo.
### Deactivating Demo Mode
Under Settings > Users, turn off the Demo Mode toggle. You will have to enter your admin password in order for it to be disabled, so do not worry about users attempting this. BenOS HTML has strict protocols preventing Demo Mode from being disabled by anyone not authorized to do so.
### What does Demo Mode do?
Demo Mode restricts users' capabilities. First of all, users will only be allowed to access BenBrowser, BenMusic, BenPen, and Settings. This prevents them from messing with your files or using the terminal to do bad stuff. This will also prevent users from clearing notifications, shutting down BenOS, logging out of the current Demo Mode user, or deleting important things. Demo Mode also locks certain sensitive settings, like modifying the name, password, or password hint of the Demo User and keeps your account safe and secure while it is in the hands of others during Demo Mode.

## Extra info
BenOS HTML does not interact with, modify, or provide the security guarantees of your host operating system (macOS, Windows, Linux, etc.). Because storage relies on browser-based systems like IndexedDB and localStorage, clearing your browser data or cache may result in the permanent loss of virtual files and user configurations. Please back up any important files or data. Original build (Sierra) by @DedeProGames-official.
