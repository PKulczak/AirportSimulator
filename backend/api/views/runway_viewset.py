from rest_framework import viewsets

from api.models import Runway
from api.serializers.runway_dto import RunwayDto


class RunwayViewset(viewsets.ReadOnlyModelViewSet):
    queryset = Runway.objects.filter(is_active=True)
    serializer_class = RunwayDto
    pagination_class = None
