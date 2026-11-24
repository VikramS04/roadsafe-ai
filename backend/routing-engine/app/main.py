from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import routes, passability, health

app = FastAPI(
    title="RoadSafe AI Routing Engine",
    description="Internal GIS routing microservice executing NetworkX Yen's K-shortest paths and passability mathematics",
    version="1.0.0",
    docs_url="/internal/v1/docs",
    openapi_url="/internal/v1/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount internal endpoints
app.include_router(routes.router, prefix="/internal/v1/routes", tags=["Routes"])
app.include_router(passability.router, prefix="/internal/v1/passability", tags=["Passability"])
app.include_router(health.router, prefix="/internal/v1", tags=["Health"])


@app.get("/")
def read_root():
    return {
        "service": "RoadSafe AI Routing Engine",
        "access": "Internal microservice only",
        "version": "1.0.0",
    }

