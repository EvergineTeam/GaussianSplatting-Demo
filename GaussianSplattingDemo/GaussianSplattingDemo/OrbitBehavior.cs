using System;
using Evergine.Common.Attributes.Converters;
using Evergine.Common.Attributes;
using Evergine.Common.Input.Mouse;
using Evergine.Framework;
using Evergine.Framework.Graphics;
using Evergine.Mathematics;
using Evergine.Common.Input.Pointer;
using Evergine.Framework.Services;
using System.Diagnostics;

namespace GaussianSplattingDemo
{
    public class OrbitBehavior : Behavior
    {
        [BindService]
        private Clock clock = null;

        [BindComponent(false)]
        public Transform3D Transform = null;

        [BindComponent(isExactType: false, source: BindComponentSource.ChildrenSkipOwner)]
        private Transform3D targetTransform = null;

        private const int TranslationRequiredTouches = 2;
        private const int OrbitRequiredTouches = 1;

        private MouseDispatcher mouseDispatcher;
        private PointerDispatcher touchDispatcher;

        private float theta;
        private float lambda;
        private float zoom;


        private float initTheta;
        private float initLambda;
        private float initZoom;
        private Vector3 initTranslation;

        private Vector3 translateVelocity;
        private Quaternion objectOrbitSmoothDampDeriv;
        private float zoomVelocity;

        public float OrbitMouseFactor = 0.0025f;
        public float ZoomFactor = 0.5f;
        public float TouchZoomFactor = 1.5f;
        public float MaxZoom = 0.5f;
        public float MinZoom = 5f;

        [RenderPropertyAsFInput(typeof(FloatRadianToDegreeConverter), MinLimit = 0, MaxLimit = 90, Tooltip = "Max elevation angle in degrees", AsSlider = true, DesiredChange = 1, DesiredLargeChange = 5)]
        public float MaxElevationAngle = MathHelper.ToRadians(90);

        [RenderPropertyAsFInput(typeof(FloatRadianToDegreeConverter), MinLimit = -90, MaxLimit = 90, Tooltip = "Min elevation angle in degrees", AsSlider = true, DesiredChange = 1, DesiredLargeChange = 5)]
        public float MinElevationAngle = MathHelper.ToRadians(-90);
        
        public float OrbitSmooth = 50;
        public float ZoomSmooth = 100;

        public float TranslationSpeed = 0.0015f;
        public float TranslationSmooth = 100;

        private Vector3 targetTranslation;

        private int touchCount;

        private Vector2 touchGroupCenter;
        private float touchGroupDistance;

        private float CurrentTouchDistance
        {
            get
            {
                if (this.touchCount == TranslationRequiredTouches)
                {
                    return Vector2.Distance(this.touchDispatcher.Points[1].Position.ToVector2(), this.touchDispatcher.Points[0].Position.ToVector2());
                }

                return 0;
            }
        }

        private Vector2 CurrentTouchCenter
        {
            get
            {
                Vector2 center = default;
                if (this.touchCount > 0)
                {
                    for (int i = 0; i < this.touchCount; i++)
                    {
                        center += this.touchDispatcher.Points[i].Position.ToVector2();
                    }

                    center /= this.touchCount;
                }

                return center;
            }
        }

        private bool IsTouchOrbitActive => this.touchCount == OrbitRequiredTouches;
        private bool IsTouchZoomActive => this.touchCount == TranslationRequiredTouches;
        private bool IsTouchTranslationActive => this.touchCount == TranslationRequiredTouches;


        /// <inheritdoc/>
        protected override bool OnAttached()
        {
            this.initTranslation = this.targetTranslation = this.Transform.LocalPosition;
            this.initTheta = this.theta = -this.Transform.LocalRotation.Y;
            this.initLambda = this.lambda = -this.Transform.LocalRotation.X;
            this.initZoom = this.zoom = this.targetTransform.LocalPosition.Z;

            return base.OnAttached();
        }

        protected override void Start()
        {
            base.Start();

            var display = this.Managers.RenderManager.ActiveCamera3D?.Display;
            if (display != null)
            {
                this.mouseDispatcher = display.MouseDispatcher;
                this.touchDispatcher = display.TouchDispatcher;

                if (this.touchDispatcher != null)
                {
                    this.touchDispatcher.PointerDown += TouchDispatcher_PointerDown;
                    this.touchDispatcher.PointerUp += TouchDispatcher_PointerUp;
                }
            }
        }

        /// <inheritdoc/>
        protected override void Update(TimeSpan gameTime)
        {
            this.HandleOrbit();
            this.HandleZoom();
            this.HandleTranslation();
        }

        public void ResetPosition(Vector3 newPosition)
        {
            this.translateVelocity = Vector3.Zero;
            this.Transform.Position = newPosition;
            this.targetTranslation = newPosition;
        }

        public void ResetZoom(float newZoom)
        {
            this.zoom = newZoom;
            this.zoomVelocity =  0;
            var p = this.targetTransform.LocalPosition;
            p.Z = newZoom;
            this.targetTransform.LocalPosition = p;
        }

        public void ResetOrbit(float newTheta, float newLambda)
        {
            this.theta = newTheta;
            this.lambda = newLambda;

            this.Transform.LocalOrientation = Quaternion.CreateFromYawPitchRoll(-this.theta, -this.lambda, 0);
        }

        public void ResetCameraToInit()
        {
            this.translateVelocity = Vector3.Zero;
            this.zoomVelocity = 0;

            this.ResetZoom(this.initZoom);
            this.ResetPosition(this.initTranslation);
            this.ResetOrbit(this.initTheta, this.initLambda);
        }

        private void HandleOrbit()
        {
            Vector2 deltaRotation = default;
            
            // Mouse orbit...
            if (this.mouseDispatcher != null && this.mouseDispatcher.IsButtonDown(MouseButtons.Left))
            {
                deltaRotation += this.mouseDispatcher.PositionDelta.ToVector2() * this.OrbitMouseFactor;
            }

            // Touch orbit...
            if (this.IsTouchOrbitActive)
            {
                var currentPosition = this.CurrentTouchCenter;
                deltaRotation += (currentPosition - this.touchGroupCenter) * this.OrbitMouseFactor;

                this.touchGroupCenter = currentPosition;
            }

            this.theta += deltaRotation.X;
            this.lambda += deltaRotation.Y;
            this.lambda = Math.Max(this.MinElevationAngle, Math.Min(this.MaxElevationAngle, this.lambda));

            // Update the transform...
            var direction = Quaternion.CreateFromYawPitchRoll(-this.theta, -this.lambda, 0);

            float elapsedMilliseconds = (float)clock.ElapseTime.TotalMilliseconds;
            this.Transform.LocalOrientation = Quaternion.SmoothDamp(
                this.Transform.LocalOrientation,
                direction,
                ref this.objectOrbitSmoothDampDeriv,
                this.OrbitSmooth,
                elapsedMilliseconds);
        }

        private void HandleZoom()
        {
            float deltaZoom = 1;

            // Handle mouse zoom...
            var scrollDeltaY = this.mouseDispatcher.ScrollDelta.Y;
            if (scrollDeltaY != 0)
            {
                deltaZoom = 1 - (scrollDeltaY * this.ZoomFactor);
            }

            // Handle touch zoom...
            if (this.IsTouchZoomActive)
            {
                var lastTouchDistance = this.CurrentTouchDistance;
                if (lastTouchDistance > 5)
                {
                    deltaZoom = 1 + (1 - (lastTouchDistance / this.touchGroupDistance)) * this.TouchZoomFactor;
                    this.touchGroupDistance = lastTouchDistance;
                }
            }

            this.zoom *= deltaZoom;
            this.zoom = Math.Max(this.MaxZoom, Math.Min(this.MinZoom, this.zoom));

            // Update the transform...
            float elapsedMilliseconds = (float)clock.ElapseTime.TotalMilliseconds;
            var localPos = this.targetTransform.LocalPosition;
            localPos.Z = MathHelper.SmoothDamp(
                localPos.Z,
                this.zoom,
                ref this.zoomVelocity,
                this.ZoomSmooth,
                elapsedMilliseconds);
            this.targetTransform.LocalPosition = localPos;
        }

        private void TouchDispatcher_PointerUp(object sender, PointerEventArgs e)
        {
            this.touchCount--;
            this.CheckTouchDisplacementAndZoom();

        }

        private void TouchDispatcher_PointerDown(object sender, PointerEventArgs e)
        {
            this.touchCount++;
            this.CheckTouchDisplacementAndZoom();
        }

        private void CheckTouchDisplacementAndZoom()
        {
            switch (this.touchCount)
            {
                case OrbitRequiredTouches:
                    this.touchGroupCenter = this.CurrentTouchCenter;
                    break;
                case TranslationRequiredTouches:
                    this.touchGroupCenter = this.CurrentTouchCenter;
                    this.touchGroupDistance = this.CurrentTouchDistance;
                    break;
            }
        }

        private void HandleTranslation()
        {
            // Mouse translation...
            if (this.mouseDispatcher?.IsButtonDown(MouseButtons.Right) == true || this.mouseDispatcher?.IsButtonDown(MouseButtons.Middle) == true)
            {
                var deltaTranslation = this.mouseDispatcher.PositionDelta.ToVector2() * this.TranslationSpeed * this.targetTransform.LocalPosition.Z;
                this.targetTranslation += this.targetTransform.Left * deltaTranslation.X + this.targetTransform.Up * deltaTranslation.Y;
            }

            // Touch translation...
            if (this.IsTouchTranslationActive)
            {
                var lastTouchCenter = this.CurrentTouchCenter;
                var delta = lastTouchCenter - this.touchGroupCenter;

                var deltaTranslation = delta * this.TranslationSpeed * this.targetTransform.LocalPosition.Z;
                this.targetTranslation += this.targetTransform.Left * deltaTranslation.X + this.targetTransform.Up * deltaTranslation.Y;

                this.touchGroupCenter = lastTouchCenter;
            }

            // Update the transform...
            float elapsedMilliseconds = (float)clock.ElapseTime.TotalMilliseconds;
            this.Transform.LocalPosition = Vector3.SmoothDamp(this.Transform.LocalPosition, this.targetTranslation, ref this.translateVelocity, this.TranslationSmooth, elapsedMilliseconds);
        }
    }
}
