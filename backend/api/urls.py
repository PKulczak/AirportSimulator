from rest_framework.routers import DefaultRouter

from api.views.runway_viewset import RunwayViewset
from api.views.simulation_viewset import SimulationViewset

router = DefaultRouter()
router.register(r"simulations", SimulationViewset, basename="simulation")
router.register(r"runways", RunwayViewset, basename="runway")

urlpatterns = router.urls
