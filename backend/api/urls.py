from django.urls import path
from rest_framework.routers import DefaultRouter

from api.views.auth_views import CurrentUserView, LoginView, LogoutView
from api.views.runway_viewset import RunwayViewset
from api.views.simulation_viewset import SimulationViewset
from api.views.template_viewset import TemplateViewset

router = DefaultRouter()
router.register(r"simulations", SimulationViewset, basename="simulation")
router.register(r"runways", RunwayViewset, basename="runway")
router.register(r"templates", TemplateViewset, basename="template")

urlpatterns = router.urls + [
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", CurrentUserView.as_view(), name="auth-me"),
]
