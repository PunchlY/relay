{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake {inherit inputs;} ({lib, ...}: {
      systems = lib.systems.flakeExposed;
      imports = [
        inputs.treefmt-nix.flakeModule
      ];
      perSystem = {pkgs, ...}: {
        treefmt = {
          settings.excludes = [
            "worker-configuration.d.ts"
          ];

          programs.deadnix = {
            enable = true;
            priority = 1;
          };
          programs.alejandra = {
            enable = true;
            priority = 2;
          };

          settings.formatter.bun = {
            command = "${pkgs.bun}/bin/bun";
            options = ["fmt" "--"];
            includes = [
              "*.ts"
              "*.json"
              "*.toml"
            ];
          };
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodejs
            wrangler
          ];
        };
      };
    });
}
