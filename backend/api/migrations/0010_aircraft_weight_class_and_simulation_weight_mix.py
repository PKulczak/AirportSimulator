from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0009_simulation_last_heartbeat_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='aircraft',
            name='weight_class',
            field=models.CharField(
                choices=[('Heavy', 'Heavy'), ('Medium', 'Medium'), ('Light', 'Light')],
                default='Medium',
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name='simulation',
            name='heavy_percentage',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='simulation',
            name='medium_percentage',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='simulation',
            name='light_percentage',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
