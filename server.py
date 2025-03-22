from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import httpx
import asyncio
import json
from collections import deque
import os
from pydantic import BaseModel, Field
import logging
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn
import secrets
from datetime import datetime, timedelta
import random

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Data storage - we'll keep 24 hours of data (assuming 15-second intervals)
# 24 hours * 60 minutes * 60 seconds / 15 seconds = 5760 data points
MAX_DATA_POINTS = 5760
weather_data = deque(maxlen=MAX_DATA_POINTS)
latest_data = {}

# Add a dictionary to store map IDs and their corresponding coordinates
map_sessions = {}

class WeatherConfig:
    def __init__(self):
        self.api_key: str
        self.station_id: str
        self.latitude: float = Field(default=0)
        self.longitude: float = Field(default=0)
        self.host: str = Field(default="127.0.0.1")
        self.port: int = Field(default=8080)
        # Updated API template with specific fields and unit parameters
        self.api_template: str = Field(default="https://swd.weatherflow.com/swd/rest/observations/stn/{station_id}?bucket=1&ob_fields=timestamp%2Creport_interval%2Cwind_lull%2Cwind_avg%2Cwind_gust%2Cwind_dir%2Cstation_pressure%2Csea_level_pressure%2Cair_temp%2Crh%2Cilluminance%2Cuv%2Csolar_radiation%2Cprecip_accumulation%2Clocal_day_precip_accumulation%2Cprecip_type%2Cstrike_count%2Cstrike_distance%2Cnc_precip_accumulation%2Cnc_local_day_precip_accumulation%2Cair_temp_today_high%2Cair_temp_today_low%2Cair_temp_yesterday_high%2Cair_temp_yesterday_low%2Csea_level_pressure_today_high%2Csea_level_pressure_today_low%2Chumidity_today_high%2Chumidity_today_low&units_temp=f&units_wind=mph&units_pressure=mb&units_precip=in&units_distance=mi&api_key={api_key}")
        self.update_interval: int = Field(default=60)

        self.load_config()

    def load_config(self):
        if os.path.exists("config.json"):
            with open("config.json", "r") as f:
                config_data = json.load(f)
                self.api_key = config_data["api_key"]
                self.station_id = config_data["station_id"]
                self.latitude = config_data["latitude"]
                self.longitude = config_data["longitude"]
                self.host = config_data["host"]
                self.port = config_data["port"]
                self.api_template = config_data["api_template"]
                self.update_interval = config_data["update_interval"]

config = WeatherConfig()

async def fetch_weather_data(api_template: str, api_key: str, station_id: str):
    """
    Fetch weather data from the API using the provided template, key, and station ID.
    """
    try:
        # Format the URL with API key and station ID
        url = api_template.format(api_key=api_key, station_id=station_id)
        
        # logger.info(f"Fetching data from URL: {url}")
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=10.0)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        logger.error(f"Error fetching weather data: {e}")
        return None

async def update_weather_data():
    """
    Background task to update weather data every 15 seconds.
    """
    while True:
        try:            
            data = await fetch_weather_data(config.api_template, config.api_key, config.station_id)
            
            if data and "obs" in data and len(data["obs"]) > 0:
                # Extract relevant data
                timestamp = datetime.now().isoformat()

                # Extract the observation data (first item in the obs array)
                # The obs field is a list of lists, not a list of dictionaries
                obs_data = data["obs"][0]
                
                # Get the field names from the ob_fields array
                field_names = data.get("ob_fields", [])
                
                # Create a dictionary mapping field names to values
                obs = {}
                for i, field_name in enumerate(field_names):
                    if i < len(obs_data):
                        obs[field_name] = obs_data[i]
                
                # Extract units from the response or use defaults
                units = data.get("units", {})
                units_mapping = {
                    "temperature": units.get("units_temp", "°F"),
                    "wind_speed": units.get("units_wind", "mph"),
                    "precipitation": units.get("units_precip", "in"),
                    "pressure": units.get("units_pressure", "mb"),
                    "distance": units.get("units_distance", "mi"),
                    "illuminance": units.get("units_brightness", "lux")
                }
                
                # Process the data to extract what we need
                # Map the field names from the new API to our expected fields
                processed_data = {
                    "timestamp": timestamp,
                    "wind_speed": obs.get("wind_avg", 0),
                    "wind_direction": obs.get("wind_dir", 0),
                    "wind_gust": obs.get("wind_gust", 0),
                    "wind_lull": obs.get("wind_lull", 0),
                    "temperature": obs.get("air_temp", 0),
                    "humidity": obs.get("rh", 0),
                    "illuminance": obs.get("illuminance", 0),
                    "precipitation": obs.get("precip_accumulation", 0),
                    "lightning_strike_count": obs.get("strike_count", 0),
                    "lightning_strike_distance": obs.get("strike_distance", 0),
                    "units": units_mapping  # Add the units to the processed data
                }
                
                # Store the data
                weather_data.append(processed_data)
                global latest_data
                latest_data = processed_data
            else:
                logger.warning("No data received from API or data format unexpected")
                if data:
                    print(f"Data received but may be in unexpected format: {data}")
            
        except Exception as e:
            logger.error(f"Error in update_weather_data: {e}")
            import traceback
            traceback.print_exc()
        
        # Wait for the configured interval before the next update
        await asyncio.sleep(config.update_interval)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Don't load configuration here since we already loaded it before starting the server
    # Start the background task
    task = asyncio.create_task(update_weather_data())
    yield
    # Clean up when the app is shutting down
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        logger.info("Background task cancelled")

# Create the FastAPI app with lifespan
app = FastAPI(title="Tempest", lifespan=lifespan)

# Mount static files directory
app.mount("/tempest/static", StaticFiles(directory="static"), name="static")

# Setup Jinja2 templates with a custom function for static files
templates = Jinja2Templates(directory="templates")

# Add a custom function to templates for static files
@app.get("/tempest/static/{path:path}")
async def static_path(path: str):
    return FileResponse(f"static/{path}")

# Add a custom function to the Jinja2 environment
def static_url(path: str) -> str:
    return f"/tempest/static{path}"

templates.env.globals["static_url"] = static_url

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/tempest", response_class=HTMLResponse)
async def get_dashboard(request: Request):
    """Render the main dashboard page."""
    # Generate a unique map ID for this session
    map_id = secrets.token_hex(16)  # Generate a secure random token
    
    # Store the coordinates in the server's session data
    map_sessions[map_id] = {
        "latitude": config.latitude,
        "longitude": config.longitude,
        "created_at": datetime.now()
    }
    
    # Clean up old sessions (older than 24 hours)
    cleanup_old_sessions()
    
    # Make sure to include the correct base URL in the context
    return templates.TemplateResponse(
        "dashboard.html", 
        {
            "request": request,
            "map_id": map_id,
            "base_url": "/tempest"
        }
    )

def cleanup_old_sessions():
    """Remove map sessions older than 24 hours to prevent memory leaks."""
    now = datetime.now()
    expired_keys = []
    
    for key, data in map_sessions.items():
        if (now - data["created_at"]).total_seconds() > 86400:  # 24 hours
            expired_keys.append(key)
    
    for key in expired_keys:
        del map_sessions[key]

@app.get("/tempest/api/map/{map_id}")
async def get_map_data(map_id: str):
    """API endpoint to get map data for a specific map ID."""
    # Check if the map ID exists
    if map_id not in map_sessions:
        return {"error": "Invalid map ID"}
    
    # Return the coordinates for the specific map ID
    return {
        "latitude": map_sessions[map_id]["latitude"],
        "longitude": map_sessions[map_id]["longitude"]
    }

@app.get("/tempest/api/weather/current")
async def get_current_weather():
    """API endpoint to get the latest weather data."""
    return latest_data

@app.get("/tempest/api/weather/history")
async def get_weather_history():
    """API endpoint to get historical weather data."""
    return list(weather_data)


if __name__ == "__main__":
    try:
        print("--------------------------------")
        print(f"Running on {config.host}:{config.port}")
        print("--------------------------------")
        uvicorn.run("server:app", host=config.host, port=config.port, reload=True)
    except Exception as e:
        logger.error(f"Error starting server: {e}")
        print(f"Error starting server: {e}")