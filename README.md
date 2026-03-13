# USAX Admin Dashboard

Internal admin dashboard for USAX with branded Botpress module pages.

## Run locally / on VPS

1. Copy `.env.example` to `.env`
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open:
   ```
   http://YOUR_SERVER_IP:3000
   ```

## Default credentials

- Username: value from `ADMIN_USERNAME`
- Password: value from `ADMIN_PASSWORD`

## Notes

- The bot pages use embedded iframe panels for reliable display.
- Each module also includes an "Open Bot in New Window" fallback.
- `Ebook Proposal` is reserved as a future module placeholder.
