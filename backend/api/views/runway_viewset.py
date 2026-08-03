from rest_framework import viewsets
from rest_framework.permissions import AllowAny

from api.models import Runway
from api.serializers.runway_dto import RunwayDto


class RunwayViewset(viewsets.ReadOnlyModelViewSet):
    # Master reference data (identifier/heading/length) with no owner and
    # nothing sensitive in it — always public regardless of REQUIRE_AUTH,
    # overriding the API's default auth-gated permission. Fetched
    # unconditionally at app root by RunwayContext, including on a
    # /shared/... read-only page; without this, an anonymous visitor with no
    # account would 401 on that fetch alone and get redirected to /login
    # even though the actual shared content never needed auth at all.
    permission_classes = [AllowAny]
    queryset = Runway.objects.filter(is_active=True)
    serializer_class = RunwayDto
    pagination_class = None
