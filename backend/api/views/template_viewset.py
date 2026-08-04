from django.db.models import Q
from rest_framework import mixins, status, viewsets
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

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
    "edit a template in place" UX, only save-fresh / pick / delete.

    Slice B.1 — personal by default, with staff able to publish a global one.
    Ownership scoping mirrors `SimulationViewset`: an anonymous request (no
    `REQUIRE_AUTH`, no credentials) and a staff request both see/act on every
    template, matching the pre-B.1 open-API behaviour there's no owner to
    scope by without a real, non-staff caller."""

    queryset = Template.objects.prefetch_related("runways").all()
    serializer_class = TemplateDto
    filter_backends = [SearchFilter]
    search_fields = ["name"]

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.is_authenticated and not user.is_staff:
            if self.action == "destroy":
                # Global templates are visible (see the `else` branch below)
                # but never mutable by a non-staff caller — excluding them
                # here (rather than only checking in `destroy()`) means a
                # non-owned/global id 404s the same way an unowned Simulation
                # id does, instead of a distinct 403.
                queryset = queryset.filter(owner=user)
            else:
                queryset = queryset.filter(Q(owner=user) | Q(owner__isnull=True))
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Popped rather than left in validated_data: `is_global` isn't a real
        # model field (see `Template.is_global`), and the decision of what it
        # actually resolves to belongs here, not in the serializer — a
        # non-staff caller's request is silently ignored (their template is
        # always personal) rather than honoured or bounced with an error.
        wants_global = serializer.validated_data.pop("is_global", False)
        user = request.user if request.user.is_authenticated else None
        owner = None if (wants_global and user is not None and user.is_staff) else user
        template = serializer.save(owner=owner)

        output_serializer = self.get_serializer(template)
        headers = self.get_success_headers(output_serializer.data)
        return Response(
            output_serializer.data, status=status.HTTP_201_CREATED, headers=headers
        )
