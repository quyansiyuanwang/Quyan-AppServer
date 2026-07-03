import express, { Router, Handler } from "express";

export class RouterEnhancer {
  private router: Router;

  constructor(router?: Router) {
    this.router = router || express.Router();
  }

  get(path: string, ...handlers: Handler[]): RouterEnhancer {
    this.router.get(path, ...handlers);
    return this;
  }

  post(path: string, ...handlers: Handler[]): RouterEnhancer {
    this.router.post(path, ...handlers);
    return this;
  }
}
