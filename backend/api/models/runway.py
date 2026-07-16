from django.db import models


class Runway(models.Model):
    identifier = models.CharField(max_length=16, unique=True)
    heading_degrees = models.PositiveIntegerField()
    length_metres = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["identifier"]

    def __str__(self):
        return self.identifier
