from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework import status
from rest_framework.authtoken.models import Token

from api.models import (
    CompareShareLink,
    Simulation,
    SimulationBatch,
    SimulationBatchShareLink,
)
from tests.base_test import BaseFeatureTest


def _batch_share_url(batch_id):
    return f"/api/simulations/batch/share/?id={batch_id}"


def _compare_share_url(ids):
    return f"/api/simulations/compare/share/?ids={','.join(str(i) for i in ids)}"


def _shared_batch_results_url(token):
    return f"/api/shared/batch/{token}/results/"


def _shared_compare_url(token):
    return f"/api/shared/compare/{token}/"


class SimulationBatchShareCreationTest(BaseFeatureTest):
    """Slice A.2 — creating a batch share link is owner-scoped exactly like
    every other batch action (see SimulationBatchTest and SimulationCancelEndpointTest)."""

    def setUp(self):
        super().setUp()
        self.owner = User.objects.create_user(username="alice", password="s3cur3-pass!")
        self.other = User.objects.create_user(username="bob", password="s3cur3-pass!")
        self.owner_token = Token.objects.create(user=self.owner)
        self.other_token = Token.objects.create(user=self.other)
        self.batch = SimulationBatch.objects.create(swept_variable="arrivalRatePerHour")
        self.create_simulations(
            2, status=Simulation.Status.COMPLETE, batch=self.batch, owner=self.owner
        )

    def _as(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_batch_share_creates_a_token_and_persists_a_share_link(self):
        self._as(self.owner_token)
        response = self.client.post(_batch_share_url(self.batch.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertIn("token", body)
        self.assertTrue(
            SimulationBatchShareLink.objects.filter(
                batch=self.batch, token=body["token"]
            ).exists()
        )

    def test_batch_share_is_idempotent_and_returns_the_same_token_on_repeat_calls(self):
        self._as(self.owner_token)
        first = self.client.post(_batch_share_url(self.batch.id)).json()["token"]
        second = self.client.post(_batch_share_url(self.batch.id)).json()["token"]

        self.assertEqual(first, second)
        self.assertEqual(
            SimulationBatchShareLink.objects.filter(batch=self.batch).count(), 1
        )

    def test_batch_share_404s_for_another_users_batch(self):
        self._as(self.other_token)
        response = self.client.post(_batch_share_url(self.batch.id))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(SimulationBatchShareLink.objects.filter(batch=self.batch).exists())

    def test_batch_share_requires_id_param(self):
        self._as(self.owner_token)
        response = self.client.post("/api/simulations/batch/share/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_batch_share_404s_for_unknown_batch(self):
        self._as(self.owner_token)
        response = self.client.post(_batch_share_url(999999))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class SharedBatchResultsAccessTest(BaseFeatureTest):
    """The read-only consumption side, mirroring SharedSimulationAccessTest."""

    def setUp(self):
        super().setUp()
        self.owner = User.objects.create_user(username="alice", password="s3cur3-pass!")
        self.batch = SimulationBatch.objects.create(swept_variable="arrivalRatePerHour")
        self.first, self.second = self.create_simulations(
            2, status=Simulation.Status.COMPLETE, batch=self.batch, owner=self.owner
        )
        self.other_batch = SimulationBatch.objects.create()
        self.create_simulations(1, status=Simulation.Status.COMPLETE, batch=self.other_batch)
        self.share_link = SimulationBatchShareLink.objects.create(batch=self.batch)

    def test_shared_batch_results_returns_200_with_no_credentials(self):
        response = self.client.get(_shared_batch_results_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["batchId"], self.batch.id)
        self.assertEqual(
            {s["id"] for s in body["simulations"]}, {self.first.id, self.second.id}
        )

    def test_shared_batch_results_works_even_when_require_auth_is_on(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(_shared_batch_results_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_shared_batch_results_404s_for_an_unknown_token(self):
        response = self.client.get(_shared_batch_results_url("not-a-real-token"))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_shared_batch_results_404s_once_the_batch_is_deleted(self):
        self.batch.delete()
        response = self.client.get(_shared_batch_results_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(SimulationBatchShareLink.objects.filter(id=self.share_link.id).exists())

    def test_a_valid_batch_share_token_does_not_grant_access_to_the_owner_scoped_endpoint(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(f"/api/simulations/batch/?id={self.batch.id}")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class CompareShareCreationTest(BaseFeatureTest):
    """Slice A.2 — creating a compare share link only ever links the caller's
    own *owned* subset of the requested ids."""

    def setUp(self):
        super().setUp()
        self.owner = User.objects.create_user(username="alice", password="s3cur3-pass!")
        self.other = User.objects.create_user(username="bob", password="s3cur3-pass!")
        self.owner_token = Token.objects.create(user=self.owner)
        self.other_token = Token.objects.create(user=self.other)
        self.first, self.second = self.create_simulations(
            2, status=Simulation.Status.COMPLETE, owner=self.owner
        )

    def _as(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_compare_share_creates_a_token_linking_the_given_ids(self):
        self._as(self.owner_token)
        response = self.client.post(_compare_share_url([self.first.id, self.second.id]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertIn("token", body)
        link = CompareShareLink.objects.get(token=body["token"])
        self.assertEqual(link.simulation_ids, sorted([self.first.id, self.second.id]))

    def test_compare_share_is_idempotent_regardless_of_id_order(self):
        self._as(self.owner_token)
        first = self.client.post(
            _compare_share_url([self.first.id, self.second.id])
        ).json()["token"]
        second = self.client.post(
            _compare_share_url([self.second.id, self.first.id])
        ).json()["token"]

        self.assertEqual(first, second)
        self.assertEqual(CompareShareLink.objects.count(), 1)

    def test_compare_share_only_links_ids_the_caller_owns(self):
        self._as(self.other_token)
        their_first, their_second = self.create_simulations(
            2, status=Simulation.Status.COMPLETE, owner=self.other
        )
        response = self.client.post(
            _compare_share_url([self.first.id, their_first.id, their_second.id])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        link = CompareShareLink.objects.get(token=response.json()["token"])
        self.assertEqual(link.simulation_ids, sorted([their_first.id, their_second.id]))

    def test_compare_share_400s_when_fewer_than_2_ids_are_owned(self):
        self._as(self.other_token)
        response = self.client.post(_compare_share_url([self.first.id]))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(CompareShareLink.objects.count(), 0)

    def test_compare_share_requires_ids_param(self):
        self._as(self.owner_token)
        response = self.client.post("/api/simulations/compare/share/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_compare_share_rejects_more_than_the_max_ids(self):
        self._as(self.owner_token)
        many_ids = list(range(1, 22))  # MAX_COMPARE_IDS is 20
        response = self.client.post(_compare_share_url(many_ids))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class SharedCompareAccessTest(BaseFeatureTest):
    """The read-only consumption side, mirroring SharedSimulationAccessTest."""

    def setUp(self):
        super().setUp()
        self.owner = User.objects.create_user(username="alice", password="s3cur3-pass!")
        self.first, self.second = self.create_simulations(
            2, status=Simulation.Status.COMPLETE, owner=self.owner
        )
        self.unrelated = self.create_simulations(1, status=Simulation.Status.COMPLETE)
        self.share_link = CompareShareLink.objects.create(
            simulation_ids=sorted([self.first.id, self.second.id])
        )

    def test_shared_compare_returns_200_with_no_credentials(self):
        response = self.client.get(_shared_compare_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual({s["id"] for s in body}, {self.first.id, self.second.id})

    def test_shared_compare_works_even_when_require_auth_is_on(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(_shared_compare_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_shared_compare_404s_for_an_unknown_token(self):
        response = self.client.get(_shared_compare_url("not-a-real-token"))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_shared_compare_silently_drops_an_id_deleted_after_the_link_was_created(self):
        self.first.delete()
        response = self.client.get(_shared_compare_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual([s["id"] for s in body], [self.second.id])
