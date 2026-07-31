from rest_framework import mixins, viewsets
from rest_framework.filters import SearchFilter

from api.models import Template
from api.serializers.template_dto import TemplateDto


class TemplateViewset(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """CRUD for saved config templates (Slice 8.1) — no Update: there's no
    "edit a template in place" UX, only save-fresh / pick / delete."""

    queryset = Template.objects.prefetch_related("runways").all()
    serializer_class = TemplateDto
    filter_backends = [SearchFilter]
    search_fields = ["name"]
