from django.urls import reverse
from rest_framework import status

from api.models import Runway
from tests.base_test import BaseFeatureTest


class RunwayListTest(BaseFeatureTest):
    def test_list_returns_all_active_runways_unpaginated(self):
        baseline = Runway.objects.filter(is_active=True).count()
        self.create_runways(3)
        self.create_runways(1, is_active=False, identifier="INACTIVE")

        response = self.client.get(reverse("runway-list"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        # Unpaginated: plain list, not a Page wrapper.
        self.assertIsInstance(body, list)
        self.assertEqual(len(body), baseline + 3)
        identifiers = {item["identifier"] for item in body}
        self.assertNotIn("INACTIVE", identifiers)

    def test_list_item_shape(self):
        self.create_runways(1, identifier="TEST-SHAPE-CHECK")

        response = self.client.get(reverse("runway-list"))

        body = response.json()
        item = next(i for i in body if i["identifier"] == "TEST-SHAPE-CHECK")
        for key in ["id", "identifier", "headingDegrees", "lengthMetres", "isActive"]:
            self.assertIn(key, item)
