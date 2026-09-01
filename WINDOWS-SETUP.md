# Windows setup

1. Install Node.js 22 or newer from https://nodejs.org/.
2. Extract `broadband-diagnostics-windows.zip` into a normal folder such as Documents.
3. Double-click `START-WINDOWS.bat`.
4. Open http://localhost:3000.

The first launch installs the project dependencies for Windows. The app must be
running in the command window while you use it.

For live router readings, connect the laptop to the router's Wi-Fi. In the app,
enter the router's admin address, not the laptop address. The Windows command
`ipconfig` shows the router address beside `Default Gateway`.
