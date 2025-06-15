=====================================================
Cat in a Flat Scanner & Notifier
Cat in a Flat 扫描与通知器
=====================================================

INTRODUCTION
简介

This is a powerful user script, specialised for monitoring the "New Job Notice Board" on the Cat in a Flat UK website. It sends you instant alerts through multiple channels whenever a new job is posted. Paired with a Google Apps Script back-end, this script provides advanced features, including remote offline alerts, ensuring you never miss an opportunity.
这是一个功能强大的用户脚本，专门用于监控 Cat in a Flat 英国站点的 "New Job Notice Board"，并在有新消息时通过多种渠道向您发送即时提醒。配合Google Apps Script后端，本脚本提供了包括远程离线报警在内的高级功能，确保您不会错过任何一个机会。

-----------------------------------------------------
FEATURES
功能特性
-----------------------------------------------------

* Real-time Floating Monitor
  提供一个信息浮窗，实时显示页面刷新倒计时、Google Sheet状态更新倒计时以及当前的消息数量。

* Multi-channel Notifications
  全渠道通知：
  - Sound Alert: Plays an audible tone for new jobs. (声音提醒)
  - Desktop Pop-up: Displays a desktop notification. (浏览器弹窗)
  - Email Notification: Sends an alert email to your Google account. (邮件通知)
  - Tab Title Flashing: Flashes the browser tab title to get your attention. (标签页标题闪烁)

* Intelligent Wake-up Detection
  智能唤醒检测：
  - Automatically detects when your computer wakes from sleep and provides a local notification to remind you to check the page status.
  - 当您的电脑从休眠中唤醒时，脚本能自动检测到长时间的暂停，并弹出本地通知提醒您检查页面状态。

* Remote Offline Alerts (Heartbeat)
  远程离线报警 (心跳检测)：
  - The core advantage of this project. Even if your computer is turned off, disconnected from the internet, or the browser is closed, the back-end script will notice you are offline after a preset time (e.g., 20 minutes) and send a warning email.
  - 本项目的核心优势。即便您的电脑关机、断网或关闭了浏览器，后端的Google Apps Script也会在预设时间后发现您已“失联”，并向您的邮箱发送一封掉线警告邮件。

* Visual Settings Panel
  可视化设置面板：
  - Provides a graphical user interface to easily configure all features, including refresh intervals, notification toggles, and the Google Apps Script URL.
  - 提供一个图形化的设置界面，让您可以轻松配置所有功能，包括刷新时间、通知开关以及Google Apps Script的URL等。

* Persistent Logging System
  持久化日志系统：
  - All key operations and errors are logged, making it easy to troubleshoot any issues you might encounter.
  - 所有的关键操作和错误都会被记录下来，方便您在遇到问题时进行排查。

-----------------------------------------------------
INSTALLATION & CONFIGURATION GUIDE
安装与配置指南
-----------------------------------------------------

Please follow these four steps precisely to ensure all features function correctly.
请严格按照以下四个步骤进行操作，以确保所有功能都能正常工作。

=== STEP 1: PREREQUISITES ===
=== 第一步：准备工作 ===

1. A modern desktop browser, such as Google Chrome or Mozilla Firefox.
   一个现代的桌面浏览器，例如 Google Chrome 或 Mozilla Firefox。
2. The Tampermonkey browser extension must be installed. Official website: https://www.tampermonkey.net/
   必须安装 Tampermonkey 浏览器扩展。官网：https://www.tampermonkey.net/

=== STEP 2: INSTALL THE USER SCRIPT ===
=== 第二步：安装油猴脚本 ===

Click the link below for a one-click installation. Tampermonkey will automatically open a new tab prompting you to install the script.
点击下方的链接即可一键安装。Tampermonkey会自动打开一个新的标签页，提示您安装脚本。

--> ONE-CLICK INSTALL LINK / 一键安装链接:
https://github.com/LyundipLye/CatinaFlatScanner/raw/main/Cat_in_a_Flat_UK_Monitor.user.js

Click the 'Install' button to complete.
点击“安装”按钮完成。

=== STEP 3: SET UP THE GOOGLE APPS SCRIPT (GAS) BACK-END ===
=== 第三步：设置Google Apps Script (GAS) 后端 ===

This step is crucial for enabling email notifications and remote offline alerts.
这是实现邮件通知和远程离线报警的关键。

1. Create the Script
   创建脚本
   - Go to script.google.com
     前往 script.google.com
   - Click on "+ New project" in the top-left corner.
     点击左上角的“+ 新建项目”。

2. Paste the Code
   粘贴代码
   - Copy all the code from the `Google_Apps_Script_Backend.gs` file.
     将项目中 `Google_Apps_Script_Backend.gs` 文件的所有代码复制进去。
   - --> GET THE GAS BACK-END CODE HERE / 点击此处获取GAS后端代码:
     https://raw.githubusercontent.com/LyundipLye/CatinaFlatScanner/main/Google_Apps_Script_Backend.gs
   - Paste the code into the editor, replacing all the original content. Give your project a name (e.g., CatinaFlatScanner).
     将代码完整粘贴到编辑器中，替换掉所有原始内容。给您的项目命名。

3. Save and Deploy
   保存并部署
   - Click the save icon (💾) to save the project.
     点击软盘图标💾保存项目。
   - Click the blue "Deploy" button in the top-right corner and select "New deployment".
     点击右上角的蓝色“部署”按钮，选择“新建部署”。
   - Next to "Select type", click the gear icon (⚙️) and choose "Web app".
     在“选择类型”旁边，点击齿轮⚙️图标，选择“Web应用”。
   - Configure the settings as follows:
     进行如下配置：
     - Execute as: "Me" (执行者: 我)
     - Who has access: "Anyone" (谁拥有访问权限: 任何人)
   - Click "Deploy".
     点击“部署”。
   - An authorisation window will appear. Click "Authorise access", choose your Google account, click "Advanced" on the "unsafe" screen, then "Go to... (unsafe)" to grant the necessary permissions.
     此时会弹出授权窗口。点击“授权访问”，选择您的Google账户，在可能出现的“不安全”提示中，点击“高级”，然后选择“转至... (不安全)”并完成授权。
   - After successful authorisation, you will be given a "Web app" URL. **You must copy this URL.**
     授权成功后，您会得到一个“Web 应用”的 URL。**请务必复制这个URL**。

4. Create the Time-based Trigger (Activate Remote Alerts)
   创建时间触发器 (激活远程报警)
   - Return to the GAS editor.
     回到GAS编辑器界面。
   - In the function selection menu at the top, select the `createHeartbeatTrigger` function.
     在顶部的函数选择菜单中，选择 `createHeartbeatTrigger` 函数。
   - Click the "Run" button (▶️).
     点击“运行” (▶️) 按钮。
   - Afterwards, you can click on the "Triggers" icon (⏰) in the left-hand menu to verify that a new trigger has been successfully created.
     完成后，您可以点击左侧菜单栏的“触发器”(⏰)图标，检查是否有一个新的触发器被成功创建。

=== STEP 4: CONNECT THE USER SCRIPT TO GAS ===
=== 第四步：关联油猴脚本与GAS ===

1. Open any page on catinaflat.co.uk.
   打开任意一个 catinaflat.co.uk 的页面。
2. You should see the script's floating panel in the bottom-left corner. Click the "⚙️ Settings" button.
   您应该能看到左下角出现的脚本浮窗。点击“⚙️ 设置”按钮。
3. In the settings panel, find the "Google Apps Script URL" input field.
   在设置面板中，找到 “Google Apps Script URL” 输入框。
4. Paste the Web app URL you copied in Step 3.3.
   将您在第三步第3点中复制的Web应用URL粘贴进去。
5. Click "Save settings".
   点击“保存设置”。

All done! The system is now fully configured and operational.
至此，全部配置完成！

-----------------------------------------------------
FREQUENTLY ASKED QUESTIONS (FAQ)
常见问题
-----------------------------------------------------

1. Q: I didn't receive an offline email alert after disconnecting. Why?
   问：我关闭了网页/断网了，为什么没有立即收到掉线报警邮件？
   A: The system has two timers: the offline threshold (default: 5 mins) and the check interval (default: 1 mins). You must be offline for longer than the threshold, and the alert will only be sent after the next scheduled check runs. This can take between 20-30 minutes in total.
   答：系统有两个时间：一个是掉线阈值（默认为5分钟），另一个是检查周期（触发器每1分钟运行一次）。您的脚本必须停止更新超过阈值时间，并且警报只会在下一次检查运行时才发送，所以总共可能需要等待5-6分钟。

2. Q: I closed the webpage, but the logs in my Google Sheet are still updating. Why?
   问：我关闭了网页，为什么日志还在更新？
   A: This means an instance of the user script is still running somewhere else. Please check other browser tabs, other windows, other web browsers on the same computer, or even other computers or devices where you might have installed the script.
   答：这说明脚本的另一个实例仍在别处运行。请检查其他的浏览器标签页、窗口、您电脑上的其他浏览器、或者您安装过此脚本的其他电脑或设备。

-----------------------------------------------------
LICENCE
开源许可证
-----------------------------------------------------

This project is licensed under the MIT Licence.
本项目基于 MIT 许可证开源。
