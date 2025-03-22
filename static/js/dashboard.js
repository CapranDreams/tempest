// Global variables
let map;
let windChart;
let weatherData = [];

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    initWindChart();
    fetchCurrentWeather();
    fetchWeatherHistory();
    
    // Set up periodic data refresh (every 15 seconds)
    setInterval(fetchCurrentWeather, 15000);
    setInterval(fetchWeatherHistory, 60000); // Refresh history every minute
});

// Initialize the map
async function initMap() {
    // Get the map ID from the data attribute
    const mapId = document.getElementById('map').dataset.mapId;
    
    try {
        // Fetch the coordinates from the server
        const response = await fetch(`/tempest/api/map/${mapId}`);
        const data = await response.json();
        
        if (data.error) {
            console.error('Error fetching map data:', data.error);
            return;
        }
        
        const lat = data.latitude;
        const lng = data.longitude;
        
        map = L.map('map', {
            center: [lat, lng],
            zoom: 17,
            zoomControl: false,
            dragging: false,
            touchZoom: false,
            doubleClickZoom: false,
            scrollWheelZoom: false,
            boxZoom: false,
            tap: false
        });
        
        // Use Esri World Imagery (satellite)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        }).addTo(map);
        
        // Create a custom control for the center wind arrow
        const CenterWindArrow = L.Control.extend({
            options: {
                position: 'center'
            },
            
            onAdd: function(map) {
                this._container = L.DomUtil.create('div', 'center-wind-arrow-container');
                this._arrow = L.DomUtil.create('div', 'center-wind-arrow', this._container);
                
                // Initial rotation (will be updated with current data)
                this._arrow.style.transform = 'rotate(0deg)';
                
                return this._container;
            },
            
            updateDirection: function(direction, speed) {
                if (direction !== undefined && direction !== null) {
                    this._arrow.style.transform = `rotate(${direction}deg)`;
                    
                    // Update color based on wind speed
                    if (speed !== undefined && speed !== null) {
                        const color = this._getColorForSpeed(speed);
                        this._arrow.style.filter = `drop-shadow(0 0 5px rgba(255, 255, 255, 0.7)) hue-rotate(${color.hue}deg) saturate(${color.saturation}%)`;
                    }
                }
            },
            
            _getColorForSpeed: function(speed) {
                // Define speed thresholds and corresponding hue values
                // Hue: 0 = red, 60 = yellow, 120 = green, 180 = cyan, 240 = blue, 300 = magenta
                
                if (speed < 5) {
                    // Blue for very light winds
                    return { hue: 240, saturation: 100 };
                } else if (speed < 10) {
                    // Cyan for light winds
                    return { hue: 180, saturation: 100 };
                } else if (speed < 15) {
                    // Green for moderate winds
                    return { hue: 120, saturation: 100 };
                } else if (speed < 20) {
                    // Yellow for fresh winds
                    return { hue: 60, saturation: 100 };
                } else if (speed < 30) {
                    // Orange for strong winds
                    return { hue: 30, saturation: 100 };
                } else {
                    // Red for very strong winds
                    return { hue: 0, saturation: 100 };
                }
            }
        });
        
        // Add the position 'center' to Leaflet's control positions
        L.Control.Position = {
            CENTER: 'center'
        };
        
        // Add the control position handler
        const originalAddControl = map.addControl;
        map.addControl = function(control) {
            if (control.options.position === 'center') {
                const container = control.onAdd(map);
                const centerPoint = map.getSize().divideBy(2);
                
                L.DomUtil.setPosition(container, centerPoint.subtract(L.point(50, 50)));
                map._controlContainer.appendChild(container);
                
                return this;
            }
            
            return originalAddControl.call(this, control);
        };
        
        // Create and add the center wind arrow
        window.centerWindArrow = new CenterWindArrow();
        map.addControl(window.centerWindArrow);
        
    } catch (error) {
        console.error('Error initializing map:', error);
    }
}

// Initialize the wind chart
function initWindChart() {
    const ctx = document.getElementById('wind-chart').getContext('2d');
    
    // Add a function to get color for wind speed
    function getColorForSpeed(speed) {
        if (speed < 5) {
            return 'rgb(0, 0, 255)'; // Blue for very light winds
        } else if (speed < 10) {
            return 'rgb(0, 255, 255)'; // Cyan for light winds
        } else if (speed < 15) {
            return 'rgb(0, 255, 0)'; // Green for moderate winds
        } else if (speed < 20) {
            return 'rgb(255, 255, 0)'; // Yellow for fresh winds
        } else if (speed < 30) {
            return 'rgb(255, 165, 0)'; // Orange for strong winds
        } else {
            return 'rgb(255, 0, 0)'; // Red for very strong winds
        }
    }
    
    // Track the last hovered point
    let lastHoveredPoint = null;
    
    // Create a custom tooltip that stays in the upper left
    const fixedTooltip = {
        id: 'fixedTooltip',
        beforeDraw(chart, args, options) {
            const { ctx, chartArea, tooltip } = chart;
            
            // Update last hovered point if tooltip is active
            if (tooltip.opacity !== 0 && tooltip.dataPoints && tooltip.dataPoints.length > 0) {
                lastHoveredPoint = {
                    dataPoints: tooltip.dataPoints,
                    title: tooltip.title,
                    body: tooltip.body,
                    options: tooltip.options
                };
            }
            
            // If we don't have a last hovered point, don't draw anything
            if (!lastHoveredPoint) return;
            
            // Position in upper left of chart area
            const x = chartArea.left + 10;
            const y = chartArea.top + 10;
            
            // Get the data point index and add wind direction information
            const dataIndex = lastHoveredPoint.dataPoints[0]?.dataIndex;
            let directionInfo = '';
            
            if (dataIndex !== undefined && weatherData[dataIndex]) {
                // Get the filtered data index that corresponds to the chart point
                const filteredData = filterToOnePerMinute(weatherData);
                const pointTimestamp = new Date(lastHoveredPoint.dataPoints[0].parsed.x).getTime();
                
                // Find the matching data point in the filtered data
                const matchingPoint = filteredData.find(point => 
                    new Date(point.timestamp).getTime() === pointTimestamp
                );
                
                if (matchingPoint && matchingPoint.wind_direction !== undefined) {
                    const direction = matchingPoint.wind_direction;
                    
                    // Convert to cardinal direction
                    let directionText = '';
                    if (direction >= 337.5 || direction < 22.5) directionText = 'N';
                    else if (direction >= 22.5 && direction < 67.5) directionText = 'NE';
                    else if (direction >= 67.5 && direction < 112.5) directionText = 'E';
                    else if (direction >= 112.5 && direction < 157.5) directionText = 'SE';
                    else if (direction >= 157.5 && direction < 202.5) directionText = 'S';
                    else if (direction >= 202.5 && direction < 247.5) directionText = 'SW';
                    else if (direction >= 247.5 && direction < 292.5) directionText = 'W';
                    else if (direction >= 292.5 && direction < 337.5) directionText = 'NW';
                    
                    directionInfo = `Wind Direction: ${direction.toFixed(0)}° (${directionText})`;
                }
            }
            
            // Draw tooltip background
            ctx.save();
            ctx.fillStyle = lastHoveredPoint.options.backgroundColor;
            ctx.shadowColor = lastHoveredPoint.options.backgroundColor;
            ctx.shadowBlur = 10;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            ctx.borderRadius = 5;
            
            // Calculate width based on text
            ctx.font = lastHoveredPoint.options.titleFont.string;
            const tooltipTextWidth = ctx.measureText(lastHoveredPoint.title[0] || '').width;
            
            ctx.font = lastHoveredPoint.options.bodyFont.string;
            const bodyTextWidths = lastHoveredPoint.body.map(b => ctx.measureText(b.lines[0] || '').width);
            const directionWidth = ctx.measureText(directionInfo).width;
            
            const maxWidth = Math.max(tooltipTextWidth, ...bodyTextWidths, directionWidth) + 20; 
            
            // Calculate height based on content
            const titleHeight = lastHoveredPoint.title.length > 0 ? 20 : 0;
            const bodyHeight = lastHoveredPoint.body.length * 20;
            const directionHeight = directionInfo ? 20 : 0;
            const padding = 10;
            const height = titleHeight + bodyHeight + directionHeight + padding * 2;
            
            // Draw rounded rectangle
            ctx.beginPath();
            ctx.roundRect(x, y, maxWidth + 20, height, 5);
            ctx.fill();
            
            // Draw tooltip content
            ctx.fillStyle = lastHoveredPoint.options.titleColor;
            ctx.font = lastHoveredPoint.options.titleFont.string;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            
            // Draw title
            if (lastHoveredPoint.title.length > 0) {
                ctx.fillText(lastHoveredPoint.title[0], x + 10, y + 10);
            }
            
            // Draw body
            ctx.fillStyle = lastHoveredPoint.options.bodyColor;
            ctx.font = lastHoveredPoint.options.bodyFont.string;
            
            lastHoveredPoint.body.forEach((body, i) => {
                const textY = y + titleHeight + 10 + (i * 20);
                ctx.fillText(body.lines[0], x + 10, textY);
            });
            
            // Draw wind direction info
            if (directionInfo) {
                const directionY = y + titleHeight + bodyHeight + 10;
                ctx.fillText(directionInfo, x + 10, directionY);
            }
            
            ctx.restore();
            
            // Prevent default tooltip from drawing
            tooltip.opacity = 0;
        }
    };
    
    // Create the chart with improved time scale configuration
    windChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Wind Speed',
                    data: [],
                    borderColor: 'rgba(54, 162, 235, 1)',
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointStyle: function(context) {
                        // Get the data point index
                        const index = context.dataIndex;
                        
                        // Create a custom arrow point
                        const arrow = new Image(16, 16);
                        arrow.src = '/tempest/static/img/arrow.svg';
                        
                        return arrow;
                    },
                    pointRadius: 8,
                    pointRotation: function(context) {
                        // Get the data point index
                        const index = context.dataIndex;
                        
                        // Get the filtered data that's actually used in the chart
                        const filteredData = filterToOnePerMinute(weatherData);
                        
                        // Make sure we have data and the index is valid
                        if (!filteredData || index >= filteredData.length) return 0;
                        
                        // Get the wind direction for this point
                        const direction = filteredData[index]?.wind_direction;
                        
                        // Return the rotation angle
                        return direction !== undefined ? direction : 0;
                    },
                    pointBackgroundColor: function(context) {
                        // Get the data point index
                        const index = context.dataIndex;
                        
                        // Get the filtered data that's actually used in the chart
                        const filteredData = filterToOnePerMinute(weatherData);
                        
                        // Make sure we have data and the index is valid
                        if (!filteredData || index >= filteredData.length) return 'rgba(54, 162, 235, 1)';
                        
                        // Get the wind speed for this point
                        const speed = filteredData[index]?.wind_speed;
                        
                        // Return color based on wind speed
                        return speed !== undefined ? getColorForSpeed(speed) : 'rgba(54, 162, 235, 1)';
                    }
                },
                {
                    label: 'Wind Gust',
                    data: [],
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: false,
                    pointStyle: 'circle',
                    pointRadius: 0 // Hide points for gust line
                },
                {
                    label: 'Wind Lull',
                    data: [],
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: false,
                    pointStyle: 'circle',
                    pointRadius: 0 // Hide points for lull line
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        padding: 10
                    }
                },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    position: 'nearest',
                    external: null,
                    callbacks: {
                        title: function(tooltipItems) {
                            // Format the tooltip title as a readable date/time
                            const date = new Date(tooltipItems[0].parsed.x);
                            return date.toLocaleString();
                        },
                        afterLabel: function(context) {
                            // Add wind direction to the tooltip if available
                            const dataIndex = context.dataIndex;
                            const direction = weatherData[dataIndex]?.wind_direction;
                            
                            if (direction !== undefined && direction !== null) {
                                // Convert to cardinal direction
                                let directionText = '';
                                if (direction >= 337.5 || direction < 22.5) directionText = 'N';
                                else if (direction >= 22.5 && direction < 67.5) directionText = 'NE';
                                else if (direction >= 67.5 && direction < 112.5) directionText = 'E';
                                else if (direction >= 112.5 && direction < 157.5) directionText = 'SE';
                                else if (direction >= 157.5 && direction < 202.5) directionText = 'S';
                                else if (direction >= 202.5 && direction < 247.5) directionText = 'SW';
                                else if (direction >= 247.5 && direction < 292.5) directionText = 'W';
                                else if (direction >= 292.5 && direction < 337.5) directionText = 'NW';
                                
                                return `Wind Direction: ${direction.toFixed(0)}° (${directionText})`;
                            }
                            return '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour',
                        displayFormats: {
                            hour: 'h:mm a', // Format as 1:30 PM
                            day: 'MMM d'    // Format as Jan 1
                        },
                        tooltipFormat: 'MMM d, yyyy h:mm a'
                    },
                    title: {
                        display: true,
                        text: 'Time'
                    },
                    ticks: {
                        source: 'auto',
                        autoSkip: true,
                        maxRotation: 45,
                        minRotation: 0
                    },
                    grid: {
                        display: true,
                        drawBorder: true,
                        drawOnChartArea: true,
                        drawTicks: true,
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                },
                y: {
                    beginAtZero: true,
                    suggestedMin: 0,
                    suggestedMax: 12, // Set a minimum maximum value of 12 mph
                    min: 0, // Ensure minimum is always 0
                    grace: '5%', 
                    title: {
                        display: true,
                        text: 'Wind Speed (mph)'
                    },
                    // This ensures the max is at least 12, but can go higher if needed
                    afterDataLimits: (scale) => {
                        if (scale.max < 12) {
                            scale.max = 12;
                        }
                    },
                    grid: {
                        display: true,
                        drawBorder: true,
                        drawOnChartArea: true,
                        drawTicks: true,
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            elements: {
                point: {
                    // Show all points since we're filtering to one per minute
                    radius: function(context) {
                        return 8; // Smaller radius for all points
                    },
                    hoverRadius: 12
                }
            }
        },
        plugins: [fixedTooltip]
    });
    
    // Add a click handler to clear the tooltip
    document.getElementById('wind-chart').addEventListener('dblclick', function() {
        lastHoveredPoint = null;
        windChart.update();
    });
    
    // Add CSS for the color legend
    const style = document.createElement('style');
    style.textContent = `
        .wind-speed-color-legend {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(255, 255, 255, 0.8);
            padding: 8px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 10;
        }
        .legend-title {
            font-weight: bold;
            margin-bottom: 5px;
        }
        .legend-items {
            display: flex;
            flex-direction: column;
        }
        .legend-item {
            display: flex;
            align-items: center;
            margin: 2px 0;
        }
        .color-box {
            width: 12px;
            height: 12px;
            margin-right: 5px;
            border-radius: 2px;
        }
    `;
    document.head.appendChild(style);
}

// Fetch current weather data
async function fetchCurrentWeather() {
    try {
        const response = await fetch('/tempest/api/weather/current');
        const data = await response.json();
        console.log(data);
        
        if (data) {
            updateDashboard(data);
        }
    } catch (error) {
        console.error('Error fetching current weather data:', error);
    }
}

// Fetch weather history
async function fetchWeatherHistory() {
    try {
        const response = await fetch('/tempest/api/weather/history');
        weatherData = await response.json();
        
        if (weatherData && weatherData.length > 0) {
            // Only try to update the wind chart if it's initialized
            if (typeof windChart !== 'undefined' && windChart !== null) {
                updateWindChart();
            }
            calculateWindStats();
        }
    } catch (error) {
        console.error('Error fetching weather history:', error);
    }
}

// Update the dashboard with current weather data
function updateDashboard(data) {
    // Update last updated time
    document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
    
    // Get units from the data
    const units = data.units || {
        temperature: "°C",
        wind_speed: "km/h",
        precipitation: "mm",
        pressure: "mb",
        distance: "km",
        illuminance: "lux"
    };
    
    // Update unit labels in the UI
    document.querySelectorAll('.metric-unit').forEach(el => {
        const metricType = el.closest('.metric-card').querySelector('.metric-title').textContent.toLowerCase();
        if (metricType === 'temperature') el.textContent = units.temperature.toUpperCase();
        else if (metricType === 'humidity') el.textContent = '%';
        else if (metricType === 'illuminance') el.textContent = units.illuminance;
        else if (metricType === 'precipitation') el.textContent = units.precipitation;
        else if (metricType === 'lightning') el.textContent = 'strikes';
    });
    
    // Update top metrics panel
    document.getElementById('temperature').textContent = data.temperature !== undefined && data.temperature !== null ? data.temperature.toFixed(1) : '--';
    document.getElementById('humidity').textContent = data.humidity !== undefined && data.humidity !== null ? data.humidity.toFixed(0) : '--';
    document.getElementById('illuminance').textContent = data.illuminance !== undefined && data.illuminance !== null ? data.illuminance.toFixed(0) : '--';
    document.getElementById('precipitation').textContent = data.precipitation !== undefined && data.precipitation !== null ? data.precipitation.toFixed(1) : '--';
    document.getElementById('lightning').textContent = data.lightning_strike_count || '--';
    
    // Update wind parameters with correct units
    const windUnit = units.wind_speed;
    document.getElementById('current-wind-speed').textContent = data.wind_speed !== undefined && data.wind_speed !== null ? `${data.wind_speed.toFixed(1)} ${windUnit}` : `-- ${windUnit}`;
    document.getElementById('wind-direction').textContent = data.wind_direction !== undefined && data.wind_direction !== null ? `${data.wind_direction.toFixed(0)}°` : '--°';
    document.getElementById('wind-gust').textContent = data.wind_gust !== undefined && data.wind_gust !== null ? `${data.wind_gust.toFixed(1)} ${windUnit}` : `-- ${windUnit}`;
    document.getElementById('wind-lull').textContent = data.wind_lull !== undefined && data.wind_lull !== null ? `${data.wind_lull.toFixed(1)} ${windUnit}` : `-- ${windUnit}`;
    
    // Update wind overlay on map
    document.getElementById('wind-speed-overlay').textContent = data.wind_speed !== undefined && data.wind_speed !== null ? `${data.wind_speed.toFixed(1)} ${windUnit}` : `-- ${windUnit}`;
    
    // Update wind stats with correct units
    document.getElementById('avg-wind-speed').textContent = document.getElementById('avg-wind-speed').textContent.replace('km/h', windUnit);
    document.getElementById('max-wind-speed').textContent = document.getElementById('max-wind-speed').textContent.replace('km/h', windUnit);
    document.getElementById('min-wind-speed').textContent = document.getElementById('min-wind-speed').textContent.replace('km/h', windUnit);
    
    // Rotate wind arrow according to wind direction
    const windArrow = document.getElementById('wind-arrow');
    if (data.wind_direction !== undefined) {
        windArrow.style.transform = `rotate(${data.wind_direction}deg)`;
        
        // Also update the center map arrow if it exists
        if (window.centerWindArrow) {
            window.centerWindArrow.updateDirection(data.wind_direction, data.wind_speed);
        }
    }
}

// Update the wind chart with historical data
function updateWindChart() {
    // Check if chart exists and if we have data
    if (!windChart || !weatherData || weatherData.length === 0) return;
    
    // Filter data to one point per minute
    const filteredData = filterToOnePerMinute(weatherData);
    
    // Store the filtered data for use in point styling
    window.filteredWindData = filteredData;
    
    // Prepare data for the chart
    const chartData = filteredData.map(d => ({
        x: new Date(d.timestamp),
        y: d.wind_speed
    }));
    
    const gustData = filteredData.map(d => ({
        x: new Date(d.timestamp),
        y: d.wind_gust
    }));
    
    const lullData = filteredData.map(d => ({
        x: new Date(d.timestamp),
        y: d.wind_lull
    }));
    
    // Update chart data
    windChart.data.datasets[0].data = chartData;
    windChart.data.datasets[1].data = gustData;
    windChart.data.datasets[2].data = lullData;
    
    // Find the maximum wind value to ensure proper scaling
    const allWindValues = [
        ...chartData.map(d => d.y),
        ...gustData.map(d => d.y),
        ...lullData.map(d => d.y)
    ].filter(v => v !== undefined && v !== null);
    
    const maxWindValue = Math.max(...allWindValues, 0);
    
    // Ensure y-axis max is at least 12 mph
    const yAxis = windChart.options.scales.y;
    if (maxWindValue < 12) {
        yAxis.max = 12;
    } else {
        // If data exceeds 12 mph, let Chart.js determine the appropriate max
        yAxis.max = undefined;
    }
    
    // Update the chart
    windChart.update();
}

// Helper function to filter data to one point per minute
function filterToOnePerMinute(data) {
    if (!data || data.length === 0) return [];
    
    const minuteMap = new Map();
    
    // Group data points by minute
    data.forEach(point => {
        const date = new Date(point.timestamp);
        // Create a key in the format "YYYY-MM-DD HH:MM" to group by minute
        const minuteKey = `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;
        
        // If we haven't seen this minute yet, or if this point is newer than what we have, use it
        if (!minuteMap.has(minuteKey) || new Date(point.timestamp) > new Date(minuteMap.get(minuteKey).timestamp)) {
            minuteMap.set(minuteKey, point);
        }
    });
    
    // Convert the map back to an array and sort by timestamp
    return Array.from(minuteMap.values()).sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
    );
}

// Calculate wind statistics from historical data
function calculateWindStats() {
    if (!weatherData || weatherData.length === 0) return;
    
    const windSpeeds = weatherData.map(d => d.wind_speed).filter(v => v !== undefined && v !== null);
    
    if (windSpeeds.length === 0) return;
    
    // Calculate average, min, and max wind speeds
    const avgWindSpeed = windSpeeds.reduce((sum, speed) => sum + speed, 0) / windSpeeds.length;
    const maxWindSpeed = Math.max(...windSpeeds);
    const minWindSpeed = Math.min(...windSpeeds);
    
    // Get the wind unit from the latest data
    const windUnit = weatherData[weatherData.length - 1]?.units?.wind_speed || 'km/h';
    
    // Update the dashboard
    document.getElementById('avg-wind-speed').textContent = `${avgWindSpeed.toFixed(1)} ${windUnit}`;
    document.getElementById('max-wind-speed').textContent = `${maxWindSpeed.toFixed(1)} ${windUnit}`;
    document.getElementById('min-wind-speed').textContent = `${minWindSpeed.toFixed(1)} ${windUnit}`;
} 