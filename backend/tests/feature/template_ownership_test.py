from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token

from api.models import Template
from tests.base_test import BaseFeatureTest


class TemplateOwnershipTest(BaseFeatureTest):
    """Slice B.1 — templates are personal by default, with staff able to
    publish a global one (`owner=None`). Scoping mirrors
    `SimulationOwnershipTest`: an anonymous request still sees/acts on
    everything (no owner to scope by without a real, non-staff caller), and
    staff are exempt from the owner filter entirely.
    """

    def setUp(self):
        super().setUp()
        self.user_a = User.objects.create_user(username="alice", password="s3cur3-pass!")
        self.user_b = User.objects.create_user(username="bob", password="s3cur3-pass!")
        self.admin = User.objects.create_user(
            username="admin-staff", password="s3cur3-pass!", is_staff=True
        )
        self.token_a = Token.objects.create(user=self.user_a)
        self.token_b = Token.objects.create(user=self.user_b)
        self.token_admin = Token.objects.create(user=self.admin)
        self.runways = self.create_runways(2)

    def _as(self, user_token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {user_token.key}")

    def _payload(self, **overrides):
        payload = {
            "name": "Peak Summer Storm",
            "arrivalRatePerHour": 20,
            "departureRatePerHour": 15,
            "durationMinutes": 120,
            "maxWaitMinutes": 20,
            "includeClosures": False,
            "runways": [
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
                {"runwayId": self.runways[1].id, "operatingMode": "Mixed"},
            ],
        }
        payload.update(overrides)
        return payload


class TemplateOwnershipCreateTest(TemplateOwnershipTest):
    def test_create_sets_owner_to_the_authenticated_user(self):
        self._as(self.token_a)
        response = self.client.post(reverse("template-list"), self._payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        template = Template.objects.get(id=response.json()["id"])
        self.assertEqual(template.owner_id, self.user_a.id)
        self.assertFalse(response.json()["isGlobal"])

    def test_create_leaves_owner_null_for_an_anonymous_request(self):
        response = self.client.post(reverse("template-list"), self._payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        template = Template.objects.get(id=response.json()["id"])
        self.assertIsNone(template.owner_id)

    def test_non_staff_is_global_request_is_ignored_not_honoured(self):
        self._as(self.token_a)
        response = self.client.post(
            reverse("template-list"), self._payload(isGlobal=True), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        template = Template.objects.get(id=response.json()["id"])
        self.assertEqual(template.owner_id, self.user_a.id)
        self.assertFalse(response.json()["isGlobal"])

    def test_staff_can_create_a_global_template(self):
        self._as(self.token_admin)
        response = self.client.post(
            reverse("template-list"), self._payload(isGlobal=True), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        template = Template.objects.get(id=response.json()["id"])
        self.assertIsNone(template.owner_id)
        self.assertTrue(response.json()["isGlobal"])

    def test_staff_creates_a_personal_template_by_default(self):
        self._as(self.token_admin)
        response = self.client.post(reverse("template-list"), self._payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        template = Template.objects.get(id=response.json()["id"])
        self.assertEqual(template.owner_id, self.admin.id)


class TemplateOwnershipListTest(TemplateOwnershipTest):
    def test_non_staff_sees_own_and_global_but_not_another_users(self):
        self.create_templates(1, name="Alice's", owner=self.user_a)
        self.create_templates(1, name="Bob's", owner=self.user_b)
        self.create_templates(1, name="Global", owner=None)

        self._as(self.token_a)
        response = self.client.get(reverse("template-list"))

        names = {row["name"] for row in response.json()["results"]}
        self.assertEqual(names, {"Alice's", "Global"})

    def test_anonymous_sees_every_template_regardless_of_owner(self):
        self.create_templates(1, name="Alice's", owner=self.user_a)
        self.create_templates(1, name="Bob's", owner=self.user_b)
        self.create_templates(1, name="Global", owner=None)

        response = self.client.get(reverse("template-list"))

        names = {row["name"] for row in response.json()["results"]}
        self.assertEqual(names, {"Alice's", "Bob's", "Global"})

    def test_staff_sees_every_users_templates(self):
        self.create_templates(1, name="Alice's", owner=self.user_a)
        self.create_templates(1, name="Bob's", owner=self.user_b)
        self.create_templates(1, name="Global", owner=None)

        self._as(self.token_admin)
        response = self.client.get(reverse("template-list"))

        names = {row["name"] for row in response.json()["results"]}
        self.assertEqual(names, {"Alice's", "Bob's", "Global"})

    def test_list_marks_global_templates_with_is_global(self):
        self.create_templates(1, name="Alice's", owner=self.user_a)
        self.create_templates(1, name="Global", owner=None)

        self._as(self.token_a)
        response = self.client.get(reverse("template-list"))

        by_name = {row["name"]: row["isGlobal"] for row in response.json()["results"]}
        self.assertEqual(by_name, {"Alice's": False, "Global": True})


class TemplateOwnershipRetrieveTest(TemplateOwnershipTest):
    def test_non_staff_retrieve_404s_for_another_users_personal_template(self):
        bobs = self.create_templates(1, name="Bob's", owner=self.user_b)

        self._as(self.token_a)
        response = self.client.get(reverse("template-detail", kwargs={"pk": bobs.id}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_non_staff_can_retrieve_a_global_template(self):
        global_template = self.create_templates(1, name="Global", owner=None)

        self._as(self.token_a)
        response = self.client.get(reverse("template-detail", kwargs={"pk": global_template.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)


class TemplateOwnershipDeleteTest(TemplateOwnershipTest):
    def test_non_staff_cannot_delete_a_global_template(self):
        global_template = self.create_templates(1, name="Global", owner=None)

        self._as(self.token_a)
        response = self.client.delete(
            reverse("template-detail", kwargs={"pk": global_template.id})
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Template.objects.filter(id=global_template.id).exists())

    def test_non_staff_cannot_delete_another_users_personal_template(self):
        bobs = self.create_templates(1, name="Bob's", owner=self.user_b)

        self._as(self.token_a)
        response = self.client.delete(reverse("template-detail", kwargs={"pk": bobs.id}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Template.objects.filter(id=bobs.id).exists())

    def test_non_staff_can_delete_their_own_template(self):
        alices = self.create_templates(1, name="Alice's", owner=self.user_a)

        self._as(self.token_a)
        response = self.client.delete(reverse("template-detail", kwargs={"pk": alices.id}))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Template.objects.filter(id=alices.id).exists())

    def test_staff_can_delete_a_global_template(self):
        global_template = self.create_templates(1, name="Global", owner=None)

        self._as(self.token_admin)
        response = self.client.delete(
            reverse("template-detail", kwargs={"pk": global_template.id})
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Template.objects.filter(id=global_template.id).exists())

    def test_staff_can_delete_anyones_personal_template(self):
        alices = self.create_templates(1, name="Alice's", owner=self.user_a)

        self._as(self.token_admin)
        response = self.client.delete(reverse("template-detail", kwargs={"pk": alices.id}))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Template.objects.filter(id=alices.id).exists())
