# Cat Health Monitor

## Local Development

### Backend
```
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend
```
cd frontend
npm install
npm start
```

## Deploy to Railway

1. Push this repo to GitHub
2. Go to railway.app and create a new project from GitHub
3. Deploy backend folder, set environment variables:
   - WHISKER_EMAIL
   - WHISKER_PASSWORD
4. Deploy frontend folder, set environment variable:
   - REACT_APP_API_URL = your backend Railway URL
