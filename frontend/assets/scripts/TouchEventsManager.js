
cc.Class({
  extends: cc.Component,
  properties: {
    // For joystick begins.
    translationListenerNode: {
      default: null,
      type: cc.Node
    },
    zoomingListenerNode: {
      default: null,
      type: cc.Node
    },
    stickhead: {
      default: null,
      type: cc.Node
    },
    base: {
      default: null,
      type: cc.Node
    },
    joyStickEps: {
      default: 0.10,
      type: cc.Float
    },
    magicLeanLowerBound: {
      default: 0.414, // Tangent of (PI/8).
      type: cc.Float
    },
    magicLeanUpperBound: {
      default: 2.414, // Tangent of (3*PI/8).
      type: cc.Float
    },
    // For joystick ends.
    pollerFps: {
      default: 10,
      type: cc.Integer
    },
    linearScaleFacBase: {
      default: 1.00,
      type: cc.Float
    },
    minScale: {
      default: 1.00,
      type: cc.Float
    },
    maxScale: {
      default: 2.50,
      type: cc.Float
    },
    maxMovingBufferLength: {
      default: 1,
      type: cc.Integer
    },
    zoomingScaleFacBase: {
      default: 0.10,
      type: cc.Float
    },
    zoomingSpeedBase: {
      default: 4.0,
      type: cc.Float
    },
    linearSpeedBase: {
      default: 320.0,
      type: cc.Float
    },
    canvasNode: {
      default: null,
      type: cc.Node
    },
    mapNode: {
      default: null,
      type: cc.Node
    },
    linearMovingEps: {
      default: 0.10,
      type: cc.Float
    },
    scaleByEps: {
      default: 0.0375,
      type: cc.Float
    },
  },

  start() {},

  onLoad() {
    this.cachedStickHeadPosition = cc.v2(0.0, 0.0);
    this.canvasNode = this.mapNode.parent;
    this.mainCameraNode = this.canvasNode.getChildByName("Main Camera"); // Cannot drag and assign the `mainCameraNode` from CocosCreator EDITOR directly, otherwise it'll cause an infinite loading time, till v2.1.0.
    this.mainCamera = this.mainCameraNode.getComponent(cc.Camera);
    this.activeDirection = {
      dx: 0.0,
      dy: 0.0
    };
    this.maxHeadDistance = (0.5 * this.base.width);

    this._initTouchEvent();
    this._cachedMapNodePosTarget = [];
    this._cachedZoomRawTarget = null;

    this.mapScriptIns = this.mapNode.getComponent("Map");
    this.initialized = true;

    this._startMainLoop();
  },

  onDestroy() {
    clearInterval(this.mainLoopTimer); 
  },

  _startMainLoop() {
    const self = this;
    const linearSpeedBase = self.linearSpeedBase;
    const zoomingSpeed = self.zoomingSpeedBase;

    self.mainLoopTimer = setInterval(() => {
      if (false == self.mapScriptIns._inputControlEnabled) return;
      if (null != self._cachedMapNodePosTarget) {
        while (self.maxMovingBufferLength < self._cachedMapNodePosTarget.length) {
          self._cachedMapNodePosTarget.shift();
        }
        if (0 < self._cachedMapNodePosTarget.length && 0 == self.mapNode.getNumberOfRunningActions()) {
          const nextMapNodePosTarget = self._cachedMapNodePosTarget.shift();
          const linearSpeed = linearSpeedBase;
          const finalDiffVec = nextMapNodePosTarget.pos.sub(self.mapNode.position);
          const finalDiffVecMag = finalDiffVec.mag();
          if (self.linearMovingEps > finalDiffVecMag) {
            // Jittering.
            // cc.log("Map node moving by finalDiffVecMag == %s is just jittering.", finalDiffVecMag);
            return;
          }
          const durationSeconds = finalDiffVecMag / linearSpeed;
          cc.log("Map node moving to %o in %s/%s == %s seconds.", nextMapNodePosTarget.pos, finalDiffVecMag, linearSpeed, durationSeconds);
          const bufferedTargetPos = cc.v2(nextMapNodePosTarget.pos.x, nextMapNodePosTarget.pos.y);
          self.mapNode.runAction(cc.sequence(
            cc.moveTo(durationSeconds, bufferedTargetPos),
            cc.callFunc(() => {
              if (self._isMapOverMoved(self.mapNode.position)) {
                self.mapNode.setPosition(bufferedTargetPos);
              }
            }, self)
          ));
        }
      }
      if (null != self._cachedZoomRawTarget && false == self._cachedZoomRawTarget.processed) {
        cc.log(`Processing self._cachedZoomRawTarget == ${self._cachedZoomRawTarget}`);
        self._cachedZoomRawTarget.processed = true;
        self.mapNode.setScale(self._cachedZoomRawTarget.scale);
      }
    }, 1000 / self.pollerFps);
  },

  _initTouchEvent() {
    const self = this;
    const translationListenerNode = (self.translationListenerNode ? self.translationListenerNode : self.mapNode);  
    const zoomingListenerNode = (self.zoomingListenerNode ? self.zoomingListenerNode : self.mapNode); 

    translationListenerNode.on(cc.Node.EventType.TOUCH_START, function(event) {
      self._touchStartEvent(event);
    });
    translationListenerNode.on(cc.Node.EventType.TOUCH_MOVE, function(event) {
      self._translationEvent(event);
    });
    translationListenerNode.on(cc.Node.EventType.TOUCH_END, function(event) {
      self._touchEndEvent(event);
    });
    translationListenerNode.on(cc.Node.EventType.TOUCH_CANCEL, function(event) {
      self._touchEndEvent(event);
    });
    translationListenerNode.inTouchPoints = new Map(); 

    zoomingListenerNode.on(cc.Node.EventType.TOUCH_START, function(event) {
      self._touchStartEvent(event);
    });
    zoomingListenerNode.on(cc.Node.EventType.TOUCH_MOVE, function(event) {
      self._zoomingEvent(event);
    });
    zoomingListenerNode.on(cc.Node.EventType.TOUCH_END, function(event) {
      self._touchEndEvent(event);
    });
    zoomingListenerNode.on(cc.Node.EventType.TOUCH_CANCEL, function(event) {
      self._touchEndEvent(event);
    });
    zoomingListenerNode.inTouchPoints = new Map(); 
  },

  _isMapOverMoved(mapTargetPos) {
    const virtualPlayerPos = cc.v2(-mapTargetPos.x, -mapTargetPos.y);
    return tileCollisionManager.isOutOfMapNode(this.mapNode, virtualPlayerPos);
  },

  _touchStartEvent(event) {
    const theListenerNode = event.target; 
    for (let touch of event._touches) {
      theListenerNode.inTouchPoints.set(touch._id, touch);
    }
  },

  _translationEvent(event) {
    if (ALL_MAP_STATES.VISUAL != this.mapScriptIns.state) {
      return;
    }
    const theListenerNode = event.target; 
    const linearScaleFacBase = this.linearScaleFacBase; // Not used yet.
    if (1 != theListenerNode.inTouchPoints.size) {
      return;
    }
    if (!theListenerNode.inTouchPoints.has(event.currentTouch._id))  {
      return;
    }
    const diffVec = event.currentTouch._point.sub(event.currentTouch._startPoint);
    const distance = diffVec.mag();
    const overMoved = (distance > this.maxHeadDistance);
    if (overMoved) {
      const ratio = (this.maxHeadDistance / distance);
      this.cachedStickHeadPosition = diffVec.mul(ratio);
    } else {
      const ratio = (distance / this.maxHeadDistance);
      this.cachedStickHeadPosition = diffVec.mul(ratio);
    }
  },

  _zoomingEvent(event) {
    if (ALL_MAP_STATES.VISUAL != this.mapScriptIns.state) {
      return;
    }
    const theListenerNode = event.target; 
    if (2 != theListenerNode.inTouchPoints.size) {
       return;
    }
    if (2 == event._touches.length) {
      const firstTouch = event._touches[0];
      const secondTouch = event._touches[1];

      const startMagnitude = firstTouch._startPoint.sub(secondTouch._startPoint).mag();
      const currentMagnitude = firstTouch._point.sub(secondTouch._point).mag();

      let scaleBy = (currentMagnitude / startMagnitude);
      scaleBy = 1 + (scaleBy - 1) * this.zoomingScaleFacBase;
      if (1 < scaleBy && Math.abs(scaleBy - 1) < this.scaleByEps) {
        // Jitterring.
        cc.log(`ScaleBy == ${scaleBy} is just jittering.`);
        return;
      }
      if (1 > scaleBy && Math.abs(scaleBy - 1) < 0.5 * this.scaleByEps) {
        // Jitterring.
        cc.log(`ScaleBy == ${scaleBy} is just jittering.`);
        return;
      }
      if (!this.mainCamera) return;
      const targetScale = this.mainCamera.zoomRatio * scaleBy;
      if (this.minScale > targetScale || targetScale > this.maxScale) {
        return;
      }
      this.mainCamera.zoomRatio = targetScale;
      for (let child of this.mainCameraNode.children) {
        child.setScale(1/targetScale); 
      }
    }
  },

  _touchEndEvent(event) {
    const theListenerNode = event.target; 
    do {
      if (!theListenerNode.inTouchPoints.has(event.currentTouch._id)) {
        break;
      }
      const diffVec = event.currentTouch._point.sub(event.currentTouch._startPoint);
      const diffVecMag = diffVec.mag();
      if (this.linearMovingEps <= diffVecMag) {
        break;
      }
      // Only triggers map-state-switch when `diffVecMag` is sufficiently small.

      if (ALL_MAP_STATES.VISUAL != this.mapScriptIns.state) {
        break;
      }

      // TODO: Handle single-finger-click event.
    } while (false);
    this.cachedStickHeadPosition = cc.v2(0.0, 0.0);
    for (let touch of event._touches) {
      if (touch){
        theListenerNode.inTouchPoints.delete(touch._id);
      }
    }
  },

  _touchCancelEvent(event) {},

  update(dt) {
    if (this.inMultiTouch) return;
    if (true != this.initialized) return;
    this.stickhead.setPosition(this.cachedStickHeadPosition);
    const eps = this.joyStickEps;

    if (Math.abs(this.cachedStickHeadPosition.x) < eps && Math.abs(this.cachedStickHeadPosition.y) < eps) {
      this.activeDirection.dx = 0;
      this.activeDirection.dy = 0;
      return;
    }

    // TODO: Really normalize the following `normalizedDir`.
    const cachedStickHeadPositionMag = this.cachedStickHeadPosition.mag(); 
    const normalizedDir = {
      dx: this.cachedStickHeadPosition.x/cachedStickHeadPositionMag,
      dy: this.cachedStickHeadPosition.y/cachedStickHeadPositionMag,
    }; 
    this.activeDirection = normalizedDir;
  },

  discretizeDirection(continuousDx, continuousDy, eps) {
    let ret = {
      dx: 0,
      dy: 0,
    };
    if (Math.abs(continuousDx) < eps) {
      ret.dx = 0;
      ret.dy = continuousDy > 0 ? +1 : -1; // up or down
    } else if (Math.abs(continuousDy) < eps) {
      ret.dx = continuousDx > 0 ? +2 : -2; // left or right
      ret.dy = 0;
    } else {
      const criticalRatio = continuousDy / continuousDx;
      if (criticalRatio > this.magicLeanLowerBound && criticalRatio < this.magicLeanUpperBound) {
        ret.dx = continuousDx > 0 ? +2 : -2; 
        ret.dy = continuousDx > 0 ? +1 : -1;
      } else if (criticalRatio > -this.magicLeanUpperBound && criticalRatio < -this.magicLeanLowerBound) {
        ret.dx = continuousDx > 0 ? +2 : -2;
        ret.dy = continuousDx > 0 ? -1 : +1;
      } else {
        if (Math.abs(criticalRatio) < 1) {
          ret.dx = continuousDx > 0 ? +2 : -2;
          ret.dy = 0;
        } else {
          ret.dx = 0;
          ret.dy = continuousDy > 0 ? +1 : -1;
        }
      }
    }
    return ret;
  },
});
