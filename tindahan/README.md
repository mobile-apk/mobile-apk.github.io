# Tindahan POS

Offline point-of-sale for small stores: sell, items and stock, utang, cash drawer, expenses, reports, receipts, barcode scanning. Plain HTML/CSS/JS, no build step.

## 1. Put it on GitHub Pages
1. Create a GitHub repo. **Name it `YOUR-USERNAME.github.io`** (this puts the app at the root of your domain, which the Android app needs to open full screen).
2. Upload every file in this folder, including `icons/` and the hidden `.nojekyll` file.
3. Repo **Settings > Pages > Deploy from a branch > main / (root)**. Wait a minute.
4. Open `https://YOUR-USERNAME.github.io/` on your phone in Chrome. Turn on airplane mode and reload to confirm it still opens.

## 2. Make the APK with PWABuilder
1. Go to pwabuilder.com, paste your URL, press Start.
2. **Package for stores > Android**. Set a package ID such as `com.yourname.tindahan`.
3. Signing key: choose **New**. Download the zip and **keep the keystore file and its password**. You need them for every future update to the same app.
4. In the zip you get the signed `.apk` (install it on phones directly) and an `assetlinks.json`.
5. Create a folder `.well-known` in your repo and put `assetlinks.json` inside. Push it. Without this the app shows a browser address bar at the top.
6. For Google Play, upload the `.aab` from the same zip instead.

## 3. Updating later
The APK just opens your hosted site, so you do not rebuild it. Edit the files, raise the version in `CACHE = 'tindahan-v6'` in `sw.js` by one (v6 to v7), push, and phones update the next time they open the app online.

## Good to know
- Data is stored on each phone only. Use **Settings > Save backup** regularly. Clearing app or Chrome data erases it.
- Camera barcode scanning needs Chrome on Android. USB and Bluetooth scanners also work: tap the search box and scan.
- GCash and Maya: save your own QR code in Settings > Payment QR codes. It is shown to the customer at checkout. The app cannot confirm the money arrived, so check your GCash or Maya app before tapping Confirm.
- Printing: Settings > Receipt printing. Choose the phone print dialog, a Bluetooth (BLE) thermal printer, or the RawBT app, and optionally print automatically after every sale.
- Cash drawer: with a Bluetooth or RawBT printer that has a drawer port, tick Settings > Receipt printing > Open cash drawer on cash sales.
- Editable receipt: store name, address/tagline, phone, footer message and a logo image, all in Settings.
- Admin PIN: set one in Settings > Admin PIN. Once set, voiding a sale or erasing all data asks for the PIN, so a cashier can't do either without the owner.
- Load and bill payments are recorded with the **+** button as a custom amount. They are not sent to any provider.
