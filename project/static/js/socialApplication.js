"use strict";

var app = angular.module('socialApplication', ['ngRoute', 'ngAnimate', 'ui.bootstrap', 'socialSiteControllers'])
.constant('BaseURL', 'http://localhost:45555/')
.config(["$routeProvider", function($routeProvider) {
  $routeProvider
  .when('/login', {
    templateUrl: 'partials/auth.html',
    controller: 'AuthController',
    secure: false
  })
  .when('/register', {
    templateUrl: 'partials/auth.html',
    controller: 'AuthController',
    secure: false
  })
  .when('/logout', {
    templateUrl: 'partials/auth.html',
    controller: 'AuthController',
    secure: true
  })
  .when('/profile/:id?', {
    templateUrl: '/partials/profile.html',
    controller: 'ProfileController',
    secure: true
  })
  .otherwise('/profile');
}]).run(['$localStorage', '$location', '$rootScope', 'ChatService', function($localStorage, $location, $rootScope, ChatService ) {
  $rootScope.$on('$routeChangeStart', function(e, next, current) {
    if (next.$$route && next.$$route.secure && !$localStorage.loggedIn) {
      e.preventDefault();
      $rootScope.$evalAsync(function() {
        $location.path('/login');
      });
    } // Only unsecure routes are login and register, neither of which should be useable while already logged in
    else if (next.$$route && !next.$$route.secure && $localStorage.loggedIn) {
      e.preventDefault();
      $rootScope.$evalAsync(function() {
        $location.path('/profile');
      });
    }
  });
  if ($localStorage.loggedIn) {
    ChatService.start();
  }
}]);
