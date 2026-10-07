export class EmailAlreadyInUseError extends Error {
    constructor(options?: ErrorOptions) {
      super('Já existe uma conta com este e-mail.', options);
  
      this.name = 'EmailAlreadyInUseError';
    }
  }